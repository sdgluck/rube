/**
 * Look for problems that are too slow to find when the page opens, then
 * announce anything new.
 *
 * The slow part is the episode-level comparison of every linked Sonarr series
 * with its Plex show (`domains/problems/src/scan.ts`). Everything else on the
 * Problems page is a local query; it runs here too only so `problems.found`
 * covers it.
 *
 * Not checkpointed: `show_checks` is the resume point. A show finished before
 * an interruption has its signature stored, and the next run skips it.
 *
 * Reports and never repairs, like `check-arr-quality`. Every fix changes Plex,
 * and the Problems page is where someone decides to make that change.
 */

import { ServicesToken, type Services } from "@tinkerbell/composition";
import type { CommonJobConfig, JobContext } from "@tinkerbell/core";

export function createScanProblemsCommand(deps: Services) {
  const { problems } = deps;

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    ctx.log("tinkerbell scan-problems");

    const sonarrs = deps.arr.arrInstances("sonarr");
    if (sonarrs.length === 0) {
      ctx.log("No Sonarr is configured — skipping the episode comparison.");
    } else {
      const result = await problems.scanShows({
        signal: ctx.signal,
        log: ctx.log,
        onProgress: (done, total) => ctx.progress(done, total, "Comparing episodes"),
      });
      ctx.log(
        `${result.total} linked show(s): ${result.checked} checked, ${result.unchanged} unchanged, ${result.failed} failed.`,
      );
      if (result.pruned > 0) ctx.log(`Dropped ${result.pruned} result(s) for series no longer linked to Plex.`);
      // Every show failing means Plex or Sonarr is down, and a run that says
      // "ok" over that would hide it. Some failing is one odd show.
      if (result.checked === 0 && result.failed > 0) {
        throw new Error(`Every show failed to compare (${result.failed}).`);
      }
    }

    const fresh = problems.announceNew();
    ctx.log(fresh.length > 0 ? `${fresh.length} new problem(s) announced.` : "No new problems.");
  }

  return { run };
}

export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createScanProblemsCommand>["run"]>[1],
): Promise<void> {
  return createScanProblemsCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
