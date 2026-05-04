import { z } from "zod";
import { type PlexClient } from "@tinkerbell/plex";
import {
  getOverlayConfigs,
  addOverlayConfig,
  updateOverlayConfig,
  removeOverlayConfigById,
  moveOverlayConfig,
  reorderOverlayConfigs,
  clearOverlayConfigs,
  replaceOverlayConfigs,
  getOverlaidItemCount,
  resolveOverlayValue,
  evaluateRule,
  compositeOverlays,
  overlayPositionSchema,
  overlayTypeSchema,
  badgeStyleSchema,
  conditionalRuleSchema,
  listPresets,
  savePreset,
  deletePreset,
  presetDataSchema,
  type Badge,
} from "../domains/overlays.ts";
import { extractImdbId } from "@tinkerbell/omdb";
import { getOmdbClient } from "../lib/clients.ts";
import { t, procedure, getPlexClient } from "./_base.ts";

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

// In-memory render cache: key = sectionId:ratingKey:configHash → base64 jpeg
const renderCache = new Map<string, { image: string; ts: number }>();
const RENDER_CACHE_LIMIT = 50;
const RENDER_CACHE_TTL_MS = 10 * 60 * 1000;

function pruneRenderCache() {
  const now = Date.now();
  for (const [k, v] of renderCache) {
    if (now - v.ts > RENDER_CACHE_TTL_MS) renderCache.delete(k);
  }
  while (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value;
    if (!oldest) break;
    renderCache.delete(oldest);
  }
}

function configHash(
  configs: Array<{ id: number; position: string; overlayType: string; order: number; style: unknown; rule: unknown }>,
) {
  return JSON.stringify(
    configs
      .map((c) => ({ p: c.position, t: c.overlayType, o: c.order, s: c.style, r: c.rule }))
      .sort((a, b) => (a.p === b.p ? a.o - b.o : a.p.localeCompare(b.p))),
  );
}

export const overlaysRouter = t.router({
  configs: t.procedure
    .input(z.object({ sectionId: z.string() }))
    .query(({ input }) => getOverlayConfigs(input.sectionId)),

  addConfig: t.procedure
    .input(
      z.object({
        sectionId: z.string(),
        position: overlayPositionSchema,
        overlayType: overlayTypeSchema,
        style: badgeStyleSchema.nullable().optional(),
        rule: conditionalRuleSchema.nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const row = addOverlayConfig({
        sectionId: input.sectionId,
        position: input.position,
        overlayType: input.overlayType,
        style: input.style ?? null,
        rule: input.rule ?? null,
      });
      return row;
    }),

  updateConfig: t.procedure
    .input(
      z.object({
        id: z.number(),
        style: badgeStyleSchema.nullable().optional(),
        rule: conditionalRuleSchema.nullable().optional(),
        overlayType: overlayTypeSchema.optional(),
      }),
    )
    .mutation(({ input }) => {
      updateOverlayConfig(input.id, {
        style: input.style,
        rule: input.rule,
        overlayType: input.overlayType,
      });
      return { ok: true };
    }),

  removeConfig: t.procedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    removeOverlayConfigById(input.id);
    return { ok: true };
  }),

  moveConfig: t.procedure
    .input(z.object({ id: z.number(), position: overlayPositionSchema, order: z.number() }))
    .mutation(({ input }) => {
      moveOverlayConfig(input.id, input.position, input.order);
      return { ok: true };
    }),

  reorderConfigs: t.procedure
    .input(z.object({ sectionId: z.string(), position: overlayPositionSchema, ids: z.array(z.number()) }))
    .mutation(({ input }) => {
      reorderOverlayConfigs(input.sectionId, input.position, input.ids);
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
    const result = await client.getItems(input.sectionId, { offset: 0, size: 1 });
    if (result.items.length === 0) return null;
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
      if (configs.length === 0) return {} as Record<number, string | null>;

      const client = getPlexClient();
      const detail = await client.getItemFullDetail(input.ratingKey);
      const mediaInfo = await getMediaInfoForItem(client, detail);

      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");
      let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
      if (needsOmdb) {
        const imdbId = extractImdbId(detail.guids);
        if (imdbId) {
          const omdb = await getOmdbClient().getRatings(imdbId);
          if (omdb) ratings = omdb;
        }
      }

      const values: Record<number, string | null> = {};
      for (const cfg of configs) {
        const v = resolveOverlayValue(
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
            showStatus: detail.status,
          },
          ratings,
        );
        // Apply rule (rules can hide values).
        const allowed = evaluateRule(cfg.rule, cfg.overlayType, v, ratings);
        values[cfg.id] = allowed ? v : null;
      }
      return values;
    }),

  renderPreview: t.procedure
    .input(z.object({ sectionId: z.string(), ratingKey: z.string() }))
    .mutation(async ({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      if (configs.length === 0) throw new Error("No overlays configured");

      const cacheKey = `${input.sectionId}:${input.ratingKey}:${configHash(configs as never)}`;
      const cached = renderCache.get(cacheKey);
      if (cached) return { image: cached.image, cached: true };

      const client = getPlexClient();
      const detail = await client.getItemFullDetail(input.ratingKey);
      if (!detail.thumb) throw new Error("Item has no poster");

      const mediaInfo = await getMediaInfoForItem(client, detail);
      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");
      let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
      if (needsOmdb) {
        const imdbId = extractImdbId(detail.guids);
        if (imdbId) {
          const omdb = await getOmdbClient().getRatings(imdbId);
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
            showStatus: detail.status,
          },
          ratings,
        );
        if (!evaluateRule(cfg.rule, cfg.overlayType, value, ratings)) continue;
        if (value) {
          badges.push({
            position: cfg.position,
            type: cfg.overlayType,
            value,
            style: cfg.style ?? null,
            order: cfg.order,
          });
        }
      }

      if (badges.length === 0) throw new Error("No overlay values resolved for this item");

      const posterBuf = await client.downloadPoster(detail.thumb);
      const composited = await compositeOverlays(posterBuf, badges);
      const image = composited.toString("base64");
      renderCache.set(cacheKey, { image, ts: Date.now() });
      pruneRenderCache();
      return { image, cached: false };
    }),

  // Bulk preview across multiple random items.
  bulkPreview: t.procedure
    .input(z.object({ sectionId: z.string(), count: z.number().min(1).max(12).default(6) }))
    .mutation(async ({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      if (configs.length === 0) throw new Error("No overlays configured");

      const client = getPlexClient();
      const sample = await client.getItems(input.sectionId, { offset: 0, size: 1 });
      if (sample.items.length === 0) return { items: [] };
      const total = sample.total;

      const offsets = new Set<number>();
      while (offsets.size < Math.min(input.count, total)) {
        offsets.add(Math.floor(Math.random() * total));
      }

      const results: Array<{ title: string; ratingKey: string; image: string }> = [];
      for (const off of offsets) {
        try {
          const r = await client.getItems(input.sectionId, { offset: off, size: 1 });
          const item = r.items[0];
          if (!item) continue;
          const detail = await client.getItemFullDetail(item.ratingKey);
          if (!detail.thumb) continue;
          const mediaInfo = await getMediaInfoForItem(client, detail);
          const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");
          let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
          if (needsOmdb) {
            const imdbId = extractImdbId(detail.guids);
            if (imdbId) {
              const omdb = await getOmdbClient().getRatings(imdbId);
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
            if (!evaluateRule(cfg.rule, cfg.overlayType, value, ratings)) continue;
            if (value) {
              badges.push({
                position: cfg.position,
                type: cfg.overlayType,
                value,
                style: cfg.style ?? null,
                order: cfg.order,
              });
            }
          }
          const posterBuf = await client.downloadPoster(detail.thumb);
          const composited = badges.length > 0 ? await compositeOverlays(posterBuf, badges) : posterBuf;
          results.push({
            title: detail.title || "",
            ratingKey: detail.ratingKey,
            image: composited.toString("base64"),
          });
        } catch (err) {
          // skip individual failures
          console.warn("[overlays.bulkPreview] item failed:", err);
        }
      }
      return { items: results };
    }),

  /* ─── Presets ──────────────────────────────────────────────────────────── */

  listPresets: t.procedure.query(() => listPresets()),

  applyPreset: t.procedure.input(z.object({ sectionId: z.string(), presetId: z.string() })).mutation(({ input }) => {
    const all = listPresets();
    const preset = all.find((p) => p.id === input.presetId);
    if (!preset) throw new Error("Preset not found");
    replaceOverlayConfigs(
      input.sectionId,
      preset.data.configs.map((c) => ({
        position: c.position,
        overlayType: c.overlayType,
        style: c.style ?? null,
        rule: c.rule ?? null,
        order: c.order,
      })),
    );
    return { ok: true };
  }),

  savePreset: t.procedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(60),
        description: z.string().max(200).optional(),
        data: presetDataSchema,
      }),
    )
    .mutation(({ input }) => {
      const id = savePreset(input);
      return { id };
    }),

  savePresetFromSection: t.procedure
    .input(z.object({ sectionId: z.string(), name: z.string().min(1).max(60), description: z.string().optional() }))
    .mutation(({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      const id = savePreset({
        name: input.name,
        description: input.description,
        data: {
          configs: configs.map((c) => ({
            position: c.position,
            overlayType: c.overlayType,
            style: c.style ?? null,
            rule: c.rule ?? null,
            order: c.order,
          })),
        },
      });
      return { id };
    }),

  deletePreset: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    deletePreset(input.id);
    return { ok: true };
  }),

  /* ─── Import / Export ──────────────────────────────────────────────────── */

  exportSection: t.procedure.input(z.object({ sectionId: z.string() })).query(({ input }) => {
    const configs = getOverlayConfigs(input.sectionId);
    return {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      configs: configs.map((c) => ({
        position: c.position,
        overlayType: c.overlayType,
        style: c.style ?? null,
        rule: c.rule ?? null,
        order: c.order,
      })),
    };
  }),

  importSection: t.procedure
    .input(
      z.object({
        sectionId: z.string(),
        mode: z.enum(["replace", "append"]),
        // Validate the incoming payload here so a bad import never reaches the
        // DB. Reuses the preset config shape; we accept (and require) `version`
        // so we can reject unknown formats up front.
        data: z.object({
          version: z.literal(1),
          exportedAt: z.string().optional(),
          configs: presetDataSchema.shape.configs,
        }),
      }),
    )
    .mutation(({ input }) => {
      const incoming = input.data.configs.map((c) => ({
        position: c.position,
        overlayType: c.overlayType,
        style: c.style ?? null,
        rule: c.rule ?? null,
        order: c.order,
      }));
      if (input.mode === "replace") {
        replaceOverlayConfigs(input.sectionId, incoming);
      } else {
        for (const c of incoming) {
          addOverlayConfig({
            sectionId: input.sectionId,
            position: c.position,
            overlayType: c.overlayType,
            style: c.style,
            rule: c.rule,
          });
        }
      }
      return { ok: true, count: incoming.length };
    }),
});
