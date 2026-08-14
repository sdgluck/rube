/**
 * Seed watch history from Plex's own view log.
 *
 * Run once after configuring Plex — and safe to re-run, since it resumes from
 * the newest entry it already imported and dedupes against plays the poller
 * observed live.
 */
import { createPlexClient } from "@tinkerbell/plex";
import { getConfig, plexHealthCallback } from "@tinkerbell/core";
import { backfillFromHistory, lastBackfilledAt } from "@tinkerbell/domain.playback";
import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

export default async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
  const url = getConfig("global_plex_url");
  const token = getConfig("global_plex_token");
  if (!url || !token) throw new Error("Plex is not configured. Add the server URL and token in Settings.");

  const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });

  ctx.log(`tinkerbell playback-backfill`);
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
