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
        sectionId: z.string().optional(),
        type: z.string().optional(),
        search: z.string().optional(),
        videoResolution: z.string().optional(),
        videoCodec: z.string().optional(),
        audioCodec: z.string().optional(),
        audioChannels: z.number().optional(),
        container: z.string().optional(),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      return getLocalMediaItems({
        sectionId: input.sectionId,
        type: input.type,
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        videoResolution: input.videoResolution || undefined,
        videoCodec: input.videoCodec || undefined,
        audioCodec: input.audioCodec || undefined,
        audioChannels: input.audioChannels || undefined,
        container: input.container || undefined,
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
