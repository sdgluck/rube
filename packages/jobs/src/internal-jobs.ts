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
import { pruneHealthChecks, checkAllConfiguredServices } from "@tinkerbell/domain.health";
import { pollPlaybackOnce } from "@tinkerbell/domain.playback";
import { syncRecentlyAdded, syncMostWatched } from "@tinkerbell/domain.stats";
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
      ctx.progress(1, 2, "Pruning health checks");
      pruneHealthChecks();
      return `Purged ${result.changes} job run(s) older than 7 days.`;
    },
    timeoutMs: 10 * MINUTE_MS,
  },
  "sync-recently-added": { run: (ctx: JobContext) => syncRecentlyAdded(ctx.signal), timeoutMs: 10 * MINUTE_MS },
  "sync-most-watched": { run: (ctx: JobContext) => syncMostWatched(ctx.signal), timeoutMs: 15 * MINUTE_MS },
  healthcheck: {
    run: (ctx: JobContext) => checkAllConfiguredServices(ctx.signal),
    // Runs every minute. Anything past 5 is wedged, not slow.
    timeoutMs: 5 * MINUTE_MS,
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
