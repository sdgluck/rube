/**
 * Internal jobs run in-process without going through the Sidequest command
 * pattern. Each entry returns the log line that becomes the run's `message`
 * and final `log` content.
 */
import { and, lt, ne } from "drizzle-orm";
import { db, jobRuns } from "@tinkerbell/db";
import { pruneHealthChecks, checkAllConfiguredServices } from "@tinkerbell/domain.health";
import { syncRecentlyAdded, syncMostWatched } from "@tinkerbell/domain.stats";
import { JOB_RUN_RETENTION_MS } from "./limits.ts";

export const internalJobs: Record<string, () => string | Promise<string>> = {
  "purge-runs": () => {
    const cutoff = Date.now() - JOB_RUN_RETENTION_MS;
    const result = db
      .delete(jobRuns)
      .where(and(ne(jobRuns.status, "running"), lt(jobRuns.startedAt, cutoff)))
      .run();
    pruneHealthChecks();
    return `Purged ${result.changes} job run(s) older than 7 days.`;
  },
  "sync-recently-added": () => syncRecentlyAdded(),
  "sync-most-watched": () => syncMostWatched(),
  healthcheck: () => checkAllConfiguredServices(),
};
