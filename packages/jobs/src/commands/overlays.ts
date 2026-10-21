import { ServicesToken, type Services } from "@rube/composition";
import PQueue from "p-queue";
import { errorMessage } from "@rube/core";
import { createPlexClient } from "@rube/plex";

import { resolveOverlayValue, evaluateRule, compositeOverlays, type Badge } from "@rube/domain.overlays";
import { extractImdbId } from "@rube/omdb";

import type { JobContext, OverlaysJobConfig } from "@rube/core";

export function createOverlaysCommand(deps: Pick<Services, "clients" | "config" | "overlays">) {
  const { clients, config, overlays } = deps;
  const { plexHealthCallback, getOmdbClient } = clients;
  const { getConfig } = config;
  const { getOverlayConfigs, getOriginalPoster, saveOriginalPoster, removeOriginalPoster, getOverlaidItems } = overlays;

  async function run(ctx: JobContext, config: OverlaysJobConfig): Promise<void> {
    const mode = config.mode || "apply";

    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

    if (!PLEX_TOKEN) {
      throw new Error("Plex token is required. Configure it in Settings.");
    }

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    ctx.log(`rube overlays (${mode})`);
    ctx.log(`Server: ${PLEX_URL}`);

    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    if (config.sections && config.sections.length > 0) {
      sections = sections.filter((s) => config.sections!.includes(s.title));
    }

    // Filter to movie/show sections only
    sections = sections.filter((s) => s.type === "movie" || s.type === "show");

    if (mode === "remove") {
      await runRemove(ctx, client, sections);
    } else {
      await runApply(ctx, client, sections);
    }
  }

  async function runApply(
    ctx: JobContext,
    client: ReturnType<typeof createPlexClient>,
    sections: Array<{ key: string; title: string; type: string }>,
  ): Promise<void> {
    const queue = new PQueue({ concurrency: 3 });
    let totalProcessed = 0;
    let totalOverlaid = 0;

    for (const section of sections) {
      const configs = getOverlayConfigs(section.key);
      if (configs.length === 0) {
        ctx.log(`Section "${section.title}": no overlay configs, skipping`);
        continue;
      }

      ctx.log(`Section "${section.title}": ${configs.length} overlay(s) configured`);

      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");

      const items: Array<{ ratingKey: string; totalSize: number }> = [];

      for await (const { item, totalSize } of client.allItems(section.key)) {
        items.push({ ratingKey: item.ratingKey as string, totalSize });
      }

      const totalSize = items.length;
      ctx.log(`Found ${totalSize} items in "${section.title}"`);

      for (const { ratingKey } of items) {
        void queue.add(async () => {
          if (ctx.signal.aborted) return;

          // Skip if already overlaid (idempotent)
          const existing = getOriginalPoster(ratingKey);
          if (existing) {
            totalProcessed++;
            ctx.progress(totalProcessed, totalSize * sections.length, `Processing "${section.title}"...`);
            return;
          }

          try {
            const detail = await client.getItemFullDetail(ratingKey);
            const mediaInfo = detail.media[0] || {};
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

            if (badges.length === 0) {
              totalProcessed++;
              ctx.progress(totalProcessed, totalSize * sections.length, `Processing "${section.title}"...`);
              return;
            }

            // Save original poster reference
            const posters = await client.getPosters(ratingKey);
            const selected = posters.find((p) => p.selected);
            if (selected) {
              saveOriginalPoster(ratingKey, section.key, selected.key);
            }

            // Download, composite, upload
            if (detail.thumb) {
              const posterBuf = await client.downloadPoster(detail.thumb);
              const overlaidBuf = await compositeOverlays(posterBuf, badges);
              await client.uploadPoster(ratingKey, overlaidBuf);
              totalOverlaid++;
            }
          } catch (err) {
            ctx.log(`Error processing ${ratingKey}: ${errorMessage(err)}`);
          }

          totalProcessed++;
          ctx.progress(totalProcessed, totalSize * sections.length, `Processing "${section.title}"...`);
        });
      }

      await queue.onIdle();
    }

    ctx.log(`Done — overlaid ${totalOverlaid} poster(s)`);
  }

  async function runRemove(
    ctx: JobContext,
    client: ReturnType<typeof createPlexClient>,
    sections: Array<{ key: string; title: string; type: string }>,
  ): Promise<void> {
    const queue = new PQueue({ concurrency: 3 });
    let totalRestored = 0;
    let totalProcessed = 0;

    for (const section of sections) {
      const overlaid = getOverlaidItems(section.key);
      if (overlaid.length === 0) {
        ctx.log(`Section "${section.title}": no overlaid items, skipping`);
        continue;
      }

      ctx.log(`Section "${section.title}": restoring ${overlaid.length} poster(s)`);

      for (const item of overlaid) {
        void queue.add(async () => {
          if (ctx.signal.aborted) return;

          try {
            await client.selectPoster(item.ratingKey, item.originalPosterUrl);
            removeOriginalPoster(item.ratingKey);
            totalRestored++;
          } catch (err) {
            ctx.log(`Error restoring ${item.ratingKey}: ${errorMessage(err)}`);
          }

          totalProcessed++;
          ctx.progress(totalProcessed, overlaid.length, `Restoring posters in "${section.title}"...`);
        });
      }

      await queue.onIdle();
    }

    ctx.log(`Done — restored ${totalRestored} poster(s)`);
  }

  return { run };
}

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createOverlaysCommand>["run"]>[1],
): Promise<void> {
  return createOverlaysCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
