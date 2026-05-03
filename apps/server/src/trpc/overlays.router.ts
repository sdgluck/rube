import { z } from "zod";
import { type PlexClient } from "../clients/plex/index.ts";
import {
  getOverlayConfigs,
  setOverlayConfig,
  removeOverlayConfig,
  clearOverlayConfigs,
  getOverlaidItemCount,
  resolveOverlayValue,
  compositeOverlays,
  overlayPositionSchema,
  overlayTypeSchema,
  type Badge,
} from "../domains/overlays.ts";
import { extractImdbId, getOmdbRatings } from "../clients/omdb.ts";
import { t, procedure, getPlexClient } from "./_base.ts";

/**
 * For shows, media info lives on episodes, not on the show itself.
 * Traverse show → first season → first episode to get media info.
 */
async function getMediaInfoForItem(
  client: PlexClient,
  detail: {
    ratingKey: string;
    type: string;
    media: Array<{
      videoResolution?: string;
      videoCodec?: string;
      audioCodec?: string;
      audioChannels?: number;
      bitDepth?: number;
      colorSpace?: string;
      videoDisplayTitle?: string;
    }>;
  },
) {
  if (detail.media.length > 0) return detail.media[0];

  if (detail.type === "show") {
    const seasons = await client.getMetadataChildren(detail.ratingKey);
    if (seasons.length > 0) {
      const episodes = await client.getMetadataChildren(seasons[0].ratingKey);
      if (episodes.length > 0) {
        const ep = await client.getItemFullDetail(episodes[0].ratingKey);
        if (ep.media.length > 0) return ep.media[0];
      }
    }
  } else if (detail.type === "season") {
    const episodes = await client.getMetadataChildren(detail.ratingKey);
    if (episodes.length > 0) {
      const ep = await client.getItemFullDetail(episodes[0].ratingKey);
      if (ep.media.length > 0) return ep.media[0];
    }
  }

  return {};
}

export const overlaysRouter = t.router({
  configs: t.procedure
    .input(z.object({ sectionId: z.string() }))
    .query(({ input }) => getOverlayConfigs(input.sectionId)),

  setConfig: t.procedure
    .input(
      z.object({
        sectionId: z.string(),
        position: overlayPositionSchema,
        overlayType: overlayTypeSchema,
      }),
    )
    .mutation(({ input }) => {
      setOverlayConfig(input.sectionId, input.position, input.overlayType);
      return { ok: true };
    }),

  removeConfig: t.procedure
    .input(z.object({ sectionId: z.string(), position: overlayPositionSchema }))
    .mutation(({ input }) => {
      removeOverlayConfig(input.sectionId, input.position);
      return { ok: true };
    }),

  clearConfigs: procedure.input(z.object({ sectionId: z.string() })).mutation(({ input }) => {
    clearOverlayConfigs(input.sectionId);
    return { ok: true };
  }),

  status: t.procedure
    .input(z.object({ sectionId: z.string() }))
    .query(({ input }) => ({ count: getOverlaidItemCount(input.sectionId) })),

  sampleItem: procedure.input(z.object({ sectionId: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    // Get a random item from the section
    const result = await client.getItems(input.sectionId, { offset: 0, size: 1 });
    if (result.items.length === 0) return null;
    // Pick a random offset
    const randomOffset = Math.floor(Math.random() * result.total);
    const randomResult = await client.getItems(input.sectionId, { offset: randomOffset, size: 1 });
    const item = randomResult.items[0] || result.items[0];
    const detail = await client.getItemFullDetail(item.ratingKey);
    return detail;
  }),

  previewValues: t.procedure
    .input(z.object({ sectionId: z.string(), ratingKey: z.string() }))
    .query(async ({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      if (configs.length === 0) return {};

      const client = getPlexClient();
      const detail = await client.getItemFullDetail(input.ratingKey);
      const mediaInfo = await getMediaInfoForItem(client, detail);

      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");

      let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
      if (needsOmdb) {
        const imdbId = extractImdbId(detail.guids);
        if (imdbId) {
          const omdb = await getOmdbRatings(imdbId);
          if (omdb) ratings = omdb;
        }
      }

      const values: Record<string, string | null> = {};
      for (const cfg of configs) {
        values[cfg.position] = resolveOverlayValue(
          cfg.overlayType,
          {
            videoResolution: mediaInfo.videoResolution,
            videoCodec: mediaInfo.videoCodec,
            audioCodec: mediaInfo.audioCodec,
            audioChannels: mediaInfo.audioChannels,
            bitDepth: mediaInfo.bitDepth,
            colorSpace: mediaInfo.colorSpace,
            videoDisplayTitle: mediaInfo.videoDisplayTitle,
            contentRating: detail.contentRating,
            duration: detail.duration,
            studio: detail.studio,
            editionTitle: detail.editionTitle,
          },
          ratings,
        );
      }
      return values;
    }),

  testOverlay: t.procedure
    .input(z.object({ sectionId: z.string(), ratingKey: z.string() }))
    .mutation(async ({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      if (configs.length === 0) throw new Error("No overlays configured for this section");

      const client = getPlexClient();
      const detail = await client.getItemFullDetail(input.ratingKey);
      if (!detail.thumb) throw new Error("Item has no poster");

      const mediaInfo = await getMediaInfoForItem(client, detail);
      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");

      let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
      if (needsOmdb) {
        const imdbId = extractImdbId(detail.guids);
        if (imdbId) {
          const omdb = await getOmdbRatings(imdbId);
          if (omdb) ratings = omdb;
        }
      }

      const badges: Badge[] = [];
      for (const cfg of configs) {
        const value = resolveOverlayValue(
          cfg.overlayType,
          {
            videoResolution: mediaInfo.videoResolution,
            videoCodec: mediaInfo.videoCodec,
            audioCodec: mediaInfo.audioCodec,
            audioChannels: mediaInfo.audioChannels,
            bitDepth: mediaInfo.bitDepth,
            colorSpace: mediaInfo.colorSpace,
            videoDisplayTitle: mediaInfo.videoDisplayTitle,
            contentRating: detail.contentRating,
            duration: detail.duration,
            studio: detail.studio,
            editionTitle: detail.editionTitle,
          },
          ratings,
        );
        if (value) {
          badges.push({
            position: cfg.position,
            type: cfg.overlayType,
            value,
          });
        }
      }

      if (badges.length === 0) throw new Error("No overlay values resolved for this item");

      const posterBuf = await client.downloadPoster(detail.thumb);
      const composited = await compositeOverlays(posterBuf, badges);

      return { image: composited.toString("base64") };
    }),
});
