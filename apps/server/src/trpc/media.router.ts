import { z } from "zod";
import { getConfig, setConfig } from "#lib/config.ts";
import { getLocalMediaItems } from "#domains/media.ts";
import { getLocalCollection } from "#domains/collections.ts";
import { t, procedure, getPlexClient } from "./_base.ts";

export const mediaRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        sectionId: z.string().optional(),
        type: z.string().optional(),
        search: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().default(50),
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

    const enrichedCollections = detail.collections.map((col) => {
      const local = getLocalCollection(String(col.id));
      return {
        ratingKey: String(col.id),
        title: col.tag,
        isLocal: !!local,
        sectionTitle: local?.sectionTitle,
      };
    });

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
