import { z } from "zod";
import { getConfig, setConfig } from "@tinkerbell/core";
import { getLocalMediaItems } from "@tinkerbell/domain.media";
import { getCollectionsForItem } from "@tinkerbell/domain.collections";
import { t, procedure, getPlexClient } from "./_base.ts";
import { paginationInput } from "./_pagination.ts";

export const mediaRouter = t.router({
  list: t.procedure
    .input(
      paginationInput.extend({
        // Value filters are lists: the page's controls are multi-selects, so
        // each one carries every ticked value. Empty means "filter off".
        sectionIds: z.array(z.string()).default([]),
        types: z.array(z.string()).default([]),
        search: z.string().optional(),
        videoResolutions: z.array(z.string()).default([]),
        videoCodecs: z.array(z.string()).default([]),
        audioCodecs: z.array(z.string()).default([]),
        audioChannels: z.array(z.number()).default([]),
        containers: z.array(z.string()).default([]),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      return getLocalMediaItems({
        sectionIds: input.sectionIds,
        types: input.types,
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        videoResolutions: input.videoResolutions,
        videoCodecs: input.videoCodecs,
        audioCodecs: input.audioCodecs,
        audioChannels: input.audioChannels,
        containers: input.containers,
        sort: input.sort,
        sortDir: input.sortDir,
      });
    }),

  get: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    const detail = await client.getItemDetail(input.ratingKey);

    // Use the local membership index instead of the Plex item's `Collection`
    // refs: the latter only covers static collections, while the index also
    // captures smart-collection membership (populated during sync).
    const enrichedCollections = getCollectionsForItem(input.ratingKey).map((row) => ({
      ratingKey: row.plexRatingKey,
      title: row.title,
      sectionTitle: row.sectionTitle,
    }));

    return {
      ...detail,
      collections: enrichedCollections,
    };
  }),

  children: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getMetadataChildren(input.ratingKey);
  }),

  columns: procedure.query(() => {
    return getConfig("media_columns") ?? null;
  }),

  saveColumns: procedure.input(z.array(z.object({ id: z.string(), visible: z.boolean() }))).mutation(({ input }) => {
    setConfig("media_columns", input);
    return { ok: true };
  }),
});
