import { SECTION_TYPE_MAP } from "@tinkerbell/plex";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

/**
 * One Plex filter clause. Operators map onto Plex's own URI syntax:
 *   `=`   → `field=value`
 *   `!=`  → `field!=value`
 *   `>=`  → `field>>=value`
 *   `<=`  → `field<<=value`
 * which lets us round-trip a smart-collection URI through this rule type
 * without losing fidelity. AND-only for now — OR groups and nesting fall
 * to `unmappable` in the Plex Smart Collections importer.
 */
export interface SmartFilter {
  field: string;
  op: "=" | "!=" | ">=" | "<=";
  value: string;
}

const OP_SUFFIX: Record<SmartFilter["op"], string> = {
  "=": "=",
  "!=": "!=",
  ">=": ">>=",
  "<=": "<<=",
};

/**
 * Convert filter clauses + section context into the query string that
 * `/library/sections/N/all` accepts. Plex requires the `type` parameter
 * (movie=1, show=2, …) on filtered queries; section type drives that.
 */
export function filtersToPlexParams(filters: SmartFilter[], sectionType: string): string {
  const parts: string[] = [];
  const typeNum = SECTION_TYPE_MAP[sectionType];
  if (typeNum != null) parts.push(`type=${typeNum}`);
  for (const f of filters) {
    const suffix = OP_SUFFIX[f.op];
    parts.push(`${encodeURIComponent(f.field)}${suffix}${encodeURIComponent(f.value)}`);
  }
  return parts.join("&");
}

export const smartFilterHandler = async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
  const { ctx, client, sections, ruleConfig } = deps;
  const filters = ruleConfig.filters ?? [];
  if (filters.length === 0) {
    throw new Error("Smart filter rule has no filter clauses.");
  }

  const collectionName = ruleConfig.collectionName?.trim() || "Smart Filter";

  for (const section of sections) {
    ctx.signal?.throwIfAborted();
    const params = filtersToPlexParams(filters, section.type);
    ctx.log(`[Smart Filter] "${section.title}" — querying Plex with ${filters.length} clause(s)...`);

    const path = `/library/sections/${section.key}/all?${params}`;
    const matched = await client.fetchItemsByFilter(path);

    if (matched.length === 0) {
      ctx.log(`No matching items in "${section.title}", skipping.`);
      continue;
    }

    yield { name: collectionName, section, matched };
  }
};
