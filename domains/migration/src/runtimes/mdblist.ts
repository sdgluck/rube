import { z } from "zod";

import type { MigrationPlan, PlanItem } from "@tinkerbell/migrate";
import type { ProviderRuntime, ProviderScanResult } from "../runtime.ts";
import { type ConfigStore } from "@tinkerbell/core";

const mdbListUserListSchema = z.object({
  id: z.number(),
  name: z.string(),
  /**
   * Pre-built URL slug from the API. Preferred over reconstructing
   * `${user_name}/${name}` because list names can contain spaces and
   * other characters that would break the upstream URL.
   */
  slug: z.string().optional(),
  user_name: z.string().optional(),
  items: z.number().optional(),
  mediatype: z.string().optional(),
});

type MdbListUserList = z.infer<typeof mdbListUserListSchema>;

const mdbListUserResponseSchema = z.union([z.array(mdbListUserListSchema), z.object({ error: z.string() })]);

/**
 * Resolve an MDBList list to the slug we hand to the list_source rule.
 * The API's own `slug` field is preferred since it's already been
 * sanitised; falls back to the numeric id only when neither slug nor
 * username are present (a list-name fallback would re-introduce the
 * URL-encoding hazard the source helper now guards against).
 */
function listIdFor(list: MdbListUserList): string {
  if (list.slug) return list.slug;
  if (list.user_name) return `${list.user_name}/${list.id}`;
  return String(list.id);
}

export interface MdblistDeps {
  config: ConfigStore;
}
export function createMdblist(deps: MdblistDeps) {
  const { getConfig } = deps.config;

  async function fetchMdbUserLists(): Promise<MdbListUserList[]> {
    const apiKey = getConfig("global_mdblist_api_key");
    if (!apiKey) return [];
    const url = `https://api.mdblist.com/lists/user?apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`MDBList ${res.status} ${res.statusText}`);
    const parsed = mdbListUserResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`MDBList: unexpected response shape`);
    if (!Array.isArray(parsed.data)) throw new Error(`MDBList: ${parsed.data.error}`);
    return parsed.data;
  }

  const MDBLIST_RUNTIME: ProviderRuntime = {
    id: "mdblist",
    label: "MDBList",
    // Hits the MDBList API — only run on demand from the Settings → Migrate
    // tab, never from the cron sync hook.
    autoScan: false,
    async scan(): Promise<ProviderScanResult> {
      const lists = await fetchMdbUserLists();
      return { count: lists.length, scannedAt: Date.now(), bySection: [] };
    },
    async buildPlan(): Promise<MigrationPlan> {
      const lists = await fetchMdbUserLists();
      const proposed: PlanItem[] = lists.map((list) => ({
        key: `mdblist::${list.id}`,
        bucket: "list" as const,
        ruleType: "list_source",
        ruleName: list.name,
        // External lists aren't tied to a Plex section; the user picks which
        // sections the rule runs against on the Rules page after migration.
        sectionId: "*",
        sectionTitle: "All sections",
        ruleConfig: {
          listProvider: "mdblist",
          listId: listIdFor(list),
        },
        sampleNames: [list.name],
        replacesCount: 0,
        replacesRatingKeys: [],
      }));
      return { proposed, future: [], unmappable: [], totalSourceItems: lists.length };
    },
    // External-list provider: nothing to claim row-wise. MDBList lists live
    // outside Plex, so they can't conflict with another provider over a
    // collection row.
    claims(): boolean {
      return false;
    },
  };

  return { MDBLIST_RUNTIME };
}
