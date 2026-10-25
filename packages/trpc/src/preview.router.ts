import { perDeps } from "@rube/container";
import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";

import { getPreviewForUser, type PreviewResult } from "@rube/domain.preview";
import { shuffleSectionHubs } from "@rube/domain.shuffle-hubs";
import { t, procedure, mapNotConfiguredClient } from "./_base.ts";

// Process-local TTL cache for preview results. The underlying Plex calls
// (getHomeHubs + sharings + shared-server-details) are network-bound and
// change rarely; a short cache makes "View as" / Library switching feel
// instant for the common case where users flip between a few users.
const PREVIEW_TTL_MS = 30_000;

function previewKey(userId: number | null, sectionId: number | null, count: number): string {
  return `${userId ?? "admin"}:${sectionId ?? "all"}:${count}`;
}

/**
 * The cached home previews, and the one operation that drops them.
 *
 * Its own factory because pinning is not only the preview router's business —
 * the collection detail page pins and unpins too, and a stale preview showing a
 * hub the user just removed is the same bug whichever page caused it. One cache
 * per container, rather than one per process with an exported `clear` to undo
 * the sharing.
 */
export const createPreviewCache = perDeps(function createPreviewCache(_deps: object) {
  const previewCache = new Map<string, { value: PreviewResult; expiresAt: number }>();

  function clearPreviewCache(): void {
    previewCache.clear();
  }

  return { previewCache, clearPreviewCache };
});

export function createPreviewRouter(deps: TrpcDeps) {
  const { previewCache } = createPreviewCache(deps);

  const { clients, jobs } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { config } = deps;
  const { getConfig } = config;

  /** The same libraries the scheduled shuffle job reorders. */
  async function shuffleSections() {
    const sections = await getPlexClient().getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    return configuredLibraries ? sections.filter((s) => configuredLibraries.includes(s.title)) : sections;
  }

  const previewRouter = t.router({
    home: procedure
      .input(
        z.object({
          userId: z.number().nullable(),
          sectionId: z.number().nullable().optional(),
          count: z.number().int().positive().max(50).optional(),
        }),
      )
      .query(async ({ input }) => {
        const sectionId = input.sectionId ?? null;
        const count = input.count ?? 12;
        const key = previewKey(input.userId, sectionId, count);
        const now = Date.now();
        const cached = previewCache.get(key);
        if (cached && cached.expiresAt > now) return cached.value;

        const client = getPlexClient();
        const value = await getPreviewForUser(client, input.userId, sectionId, count);
        previewCache.set(key, { value, expiresAt: now + PREVIEW_TTL_MS });
        return value;
      }),

    unpinCollection: procedure
      .input(z.object({ sectionId: z.string(), hubIdentifier: z.string() }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await client.unpinFromHomepage(input.sectionId, input.hubIdentifier);
        previewCache.clear();
        return { ok: true };
      }),

    /**
     * Drops every cached home, for the page's Refresh. Without it a refresh
     * inside the 30s TTL would ask the server again and get back the same
     * cached answer, so the button would appear to work and change nothing.
     */
    refresh: procedure.mutation(() => {
      previewCache.clear();
      return { ok: true };
    }),

    /**
     * The libraries a shuffle reorders, so the page can shuffle them one at a
     * time and say which it is on. One mutation for every library gave a
     * spinner and nothing else for as long as Plex took — on a slow server, long
     * enough to look hung while hubs were visibly disappearing from home.
     */
    /**
     * Rating keys of the collections kept at the top, so the page can badge
     * them and leave them in place when it shows a shuffle before Plex has
     * finished one.
     */
    topPinned: procedure.query(() => [...jobs.topPinnedRatingKeys()]),

    shuffleTargets: procedure.query(async () => {
      const sections = await shuffleSections();
      return sections.map((s) => ({ key: s.key, title: s.title }));
    }),

    shuffleSection: procedure.input(z.object({ sectionKey: z.string() })).mutation(async ({ input }) => {
      const section = (await shuffleSections()).find((s) => s.key === input.sectionKey);
      if (!section) throw new Error(`Library ${input.sectionKey} is not one Rube manages`);
      const result = await shuffleSectionHubs(getPlexClient(), section, undefined, {
        keepFirst: jobs.topPinnedRatingKeys(),
      });
      previewCache.clear();
      return result;
    }),
  });

  return previewRouter;
}
