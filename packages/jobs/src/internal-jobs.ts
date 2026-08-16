/**
 * Internal jobs run in-process rather than through the Sidequest command
 * pattern — they are short, purely local, and not worth a worker thread.
 *
 * They still get a real `JobContext` (log/progress/signal/checkpoint) and are
 * still cancellable, so from the UI's point of view they behave like any other
 * job. Each returns the line that becomes the run's `message` and final `log`.
 */
import { and, lt, notInArray } from "drizzle-orm";
import { MINUTE_MS, type JobContext } from "@tinkerbell/core";
import { db, jobRuns } from "@tinkerbell/db";
import { pruneBandwidthSamples, pruneBandwidthTests, runBandwidthTest } from "@tinkerbell/domain.bandwidth";
import { pruneHealthChecks, checkAllConfiguredServices } from "@tinkerbell/domain.health";
import { pruneRuleRuns, RULE_RUN_RETENTION_MS } from "@tinkerbell/domain.rule-runs";
import { pollPlaybackOnce } from "@tinkerbell/domain.playback";
import { syncRecentlyAdded } from "@tinkerbell/domain.stats";
import { announceRegistryUpdates } from "./registry-updates.ts";
import { ACTIVE_RUN_STATUSES } from "./statuses.ts";
import { JOB_RUN_RETENTION_MS } from "./limits.ts";

export interface InternalJobDescriptor {
  run: (ctx: JobContext) => string | Promise<string>;
  /**
   * Wall-clock budget, same idea as a command's entry in the catalog.
   *
   * Internal jobs don't go through `CommandJob`, so they have no in-run
   * deadline — this is what lets the main-process watchdog force-fail one that
   * wedges. Without it a stuck `healthcheck` would occupy its job forever and
   * healthcheck would silently never run again, which is exactly the failure
   * the watchdog exists to prevent.
   */
  timeoutMs: number;
  /**
   * Suppress the routine `job.completed` event.
   *
   * `healthcheck` runs every minute — 1440 identical events a day, kept
   * tolerable only by `rollupConsecutiveEvents` collapsing them. Quiet jobs
   * emit only when the outcome text changes from the previous run. Failures
   * always emit, quiet or not.
   */
  quiet?: boolean;
}

export const internalJobs = {
  "purge-runs": {
    run: (ctx: JobContext) => {
      const cutoff = Date.now() - JOB_RUN_RETENTION_MS;
      const result = db
        .delete(jobRuns)
        // `cancelling` is excluded alongside `running`: the command is still
        // executing and still owns the row until it writes its terminal status.
        .where(and(notInArray(jobRuns.status, [...ACTIVE_RUN_STATUSES]), lt(jobRuns.startedAt, cutoff)))
        .run();
      // Rule runs are far more numerous than job runs — one Generate job writes
      // a row per rule — so they are purged on the same schedule.
      const ruleRunsPurged = pruneRuleRuns(Date.now() - RULE_RUN_RETENTION_MS);
      ctx.progress(1, 2, "Pruning health checks and bandwidth history");
      pruneHealthChecks();
      pruneBandwidthTests();
      // The usage samples are the fastest-growing table here: one row per
      // 30-second poll, whether or not anything was streaming.
      pruneBandwidthSamples();
      return `Purged ${result.changes} job run(s) and ${ruleRunsPurged} rule run(s) older than 7 days.`;
    },
    timeoutMs: 10 * MINUTE_MS,
  },
  "sync-recently-added": { run: (ctx: JobContext) => syncRecentlyAdded(ctx.signal), timeoutMs: 10 * MINUTE_MS },
  healthcheck: {
    run: (ctx: JobContext) => checkAllConfiguredServices(ctx.signal),
    // Runs every minute. Anything past 5 is wedged, not slow.
    timeoutMs: 5 * MINUTE_MS,
    quiet: true,
  },
  "bandwidth-test": {
    run: (ctx: JobContext) => runBandwidthTest(ctx),
    // The test bounds itself at 90s. Past three minutes it is wedged on a
    // socket that never closed, not measuring a very slow link.
    timeoutMs: 3 * MINUTE_MS,
  },
  "registry-updates": {
    run: () => announceRegistryUpdates(),
    // One HTTP GET against a cached index. Past a minute the registry host is
    // hanging on us, and `fetchRegistryIndex` has its own 15s timeout anyway.
    timeoutMs: 5 * MINUTE_MS,
    // Daily, and quiet: the interesting outcome is the event it emits, not the
    // 364 runs a year that find nothing new.
    quiet: true,
  },
  "playback-poll": {
    run: async (ctx: JobContext) => {
      const result = await pollPlaybackOnce(ctx.signal);
      if (!result.polled) return "Playback poll skipped.";
      const parts = [];
      if (result.recovered) parts.push(`recovered ${result.recovered} session(s) after restart`);
      if (result.opened) parts.push(`opened ${result.opened}`);
      if (result.closed) parts.push(`closed ${result.closed}`);
      // The quiet flag suppresses the event only when this text is unchanged,
      // so a tick where nothing happened must produce a stable string — hence
      // one phrasing for "no change" rather than counts that are always zero.
      return parts.length ? `Playback: ${parts.join(", ")}.` : "Playback poll: no change.";
    },
    // Runs every 30 seconds. A poll that takes more than a minute has wedged;
    // the poller's own in-flight latch drops overlapping ticks before then.
    timeoutMs: MINUTE_MS,
    quiet: true,
  },
} as const satisfies Record<string, InternalJobDescriptor>;

export type InternalJobName = keyof typeof internalJobs;

export function isInternalJobName(name: string): name is InternalJobName {
  return Object.hasOwn(internalJobs, name);
}
