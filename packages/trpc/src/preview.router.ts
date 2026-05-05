import { z } from "zod";
import { getConfig } from "@tinkerbell/core";
import { getPreviewForUser } from "@tinkerbell/domain.preview";
import { shuffleAllSections } from "@tinkerbell/domain.shuffle-hubs";
import { t, procedure, getPlexClient } from "./_base.ts";

export const previewRouter = t.router({
  home: procedure
    .input(z.object({ userId: z.number().nullable(), sectionId: z.number().nullable().optional() }))
    .query(async ({ input }) => {
      const client = getPlexClient();
      return getPreviewForUser(client, input.userId, input.sectionId ?? null);
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
    return { results, totalShuffled, sections: sections.length };
  }),
});
