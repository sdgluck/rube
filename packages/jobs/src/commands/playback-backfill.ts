import { ServicesToken, type Services } from "@rube/composition";
/**
 * Seed watch history from Plex's own view log.
 *
 * Run once after configuring Plex — and safe to re-run, since it resumes from
 * the newest entry it already imported and dedupes against plays the poller
 * observed live.
 */
import { createPlexClient } from "@rube/plex";

import type { JobContext, CommonJobConfig } from "@rube/core";

export function createPlaybackBackfillCommand(deps: Pick<Services, "clients" | "config" | "playback">) {
  const { clients, config, playback } = deps;
  const { getConfig } = config;
  const { plexHealthCallback } = clients;
  const { backfillFromHistory, lastBackfilledAt } = playback;

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    const url = getConfig("global_plex_url");
    const token = getConfig("global_plex_token");
    if (!url || !token) throw new Error("Plex is not configured. Add the server URL and token in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });

    ctx.log(`rube playback-backfill`);
    const resumeFrom = lastBackfilledAt();
    ctx.log(
      resumeFrom > 0
        ? `Resuming from ${new Date(resumeFrom).toISOString()} — earlier history is already imported.`
        : `No history imported yet; walking the full log.`,
    );

    const result = await backfillFromHistory(
      (opts) => client.getWatchHistory({ limit: opts.limit, offset: opts.offset, viewedAfter: opts.viewedAfter }),
      {
        signal: ctx.signal,
        onProgress: (scanned, imported) => {
          // The total is unknown until the walk ends, so report absolute counts
          // rather than a fraction that would jump around as it discovers pages.
          ctx.log(`Scanned ${scanned} history entr(ies), imported ${imported}.`);
        },
      },
    );

    ctx.log(
      `Imported ${result.imported} play(s) from ${result.scanned} history entr(ies) over ${result.pages} page(s); ` +
        `skipped ${result.skipped} already recorded.`,
    );
    ctx.log(
      `Note: history entries carry no completion or watch-time data — they count as plays but contribute ` +
        `no watch time. Live playback recorded by the poller does carry both.`,
    );
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
  config: Parameters<ReturnType<typeof createPlaybackBackfillCommand>["run"]>[1],
): Promise<void> {
  return createPlaybackBackfillCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
