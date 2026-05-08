import { z } from "zod";
import { getConfig } from "@tinkerbell/core";
import { getPreviewForUser, type PreviewResult } from "@tinkerbell/domain.preview";
import { shuffleAllSections } from "@tinkerbell/domain.shuffle-hubs";
import { t, procedure, getPlexClient } from "./_base.ts";

// Process-local TTL cache for preview results. The underlying Plex calls
// (getHomeHubs + sharings + shared-server-details) are network-bound and
// change rarely; a short cache makes "View as" / Library switching feel
// instant for the common case where users flip between a few users.
const PREVIEW_TTL_MS = 30_000;
const previewCache = new Map<string, { value: PreviewResult; expiresAt: number }>();

function previewKey(userId: number | null, sectionId: number | null, count: number): string {
  return `${userId ?? "admin"}:${sectionId ?? "all"}:${count}`;
}

export const previewRouter = t.router({
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

  shuffleHubs: procedure.mutation(async () => {
    const client = getPlexClient();
    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    const results = await shuffleAllSections(client, sections);
    const totalShuffled = results.reduce((sum, r) => sum + r.shuffled, 0);
    previewCache.clear();
    return { results, totalShuffled, sections: sections.length };
  }),
});
