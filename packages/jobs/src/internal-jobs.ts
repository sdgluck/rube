/**
 * Internal jobs run in-process rather than through the Sidequest command
 * pattern — they are short, purely local, and not worth a worker thread.
 *
 * They still get a real `JobContext` (log/progress/signal/checkpoint) and are
 * still cancellable, so from the UI's point of view they behave like any other
 * job. Each returns the line that becomes the run's `message` and final `log`.
 */
import { and, lt, ne } from "drizzle-orm";
import type { JobContext } from "@tinkerbell/core";
import { db, jobRuns } from "@tinkerbell/db";
import { pruneHealthChecks, checkAllConfiguredServices } from "@tinkerbell/domain.health";
import { syncRecentlyAdded, syncMostWatched } from "@tinkerbell/domain.stats";
import { JOB_RUN_RETENTION_MS } from "./limits.ts";

export interface InternalJobDescriptor {
  run: (ctx: JobContext) => string | Promise<string>;
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
        .where(and(ne(jobRuns.status, "running"), lt(jobRuns.startedAt, cutoff)))
        .run();
      ctx.progress(1, 2, "Pruning health checks");
      pruneHealthChecks();
      return `Purged ${result.changes} job run(s) older than 7 days.`;
    },
  },
  "sync-recently-added": { run: () => syncRecentlyAdded() },
  "sync-most-watched": { run: () => syncMostWatched() },
  healthcheck: { run: () => checkAllConfiguredServices(), quiet: true },
} as const satisfies Record<string, InternalJobDescriptor>;

export type InternalJobName = keyof typeof internalJobs;

export function isInternalJobName(name: string): name is InternalJobName {
  return Object.hasOwn(internalJobs, name);
}
