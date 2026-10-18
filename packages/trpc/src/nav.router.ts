import type { TrpcDeps } from "./deps.ts";
import { desc, eq, sql } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  collections,
  mediaItems,
  rules,
  plexUsers,
  jobs,
  jobRuns,
  events,
  prerolls,
  arrSyncState,
} from "@tinkerbell/db";
import { DAY_MS, WEEK_MS } from "@tinkerbell/core";

import { t, procedure } from "./_base.ts";
import { NativeAdmin } from "@tinkerbell/contracts/native-api";

/**
 * Fresh-status threshold: a tick / cross next to a sidebar item is only
 * meaningful if the underlying job ran recently. Anything older than this
 * surfaces as `null` so we render nothing instead of a stale ✓.
 */
const STATUS_FRESHNESS_MS = WEEK_MS;

export function createNavRouter(deps: Pick<TrpcDeps, "cleanup" | "db" | "problems">) {
  const { cleanup, db, problems } = deps;
  const { dueSoonCount } = cleanup;

  /** The sidebar must render even if one metric query throws. */
  function safeDueSoonCount(): number {
    try {
      return dueSoonCount();
    } catch {
      return 0;
    }
  }

  /** Open faults on the Problems page. Cached for a minute by the domain. */
  function safeProblemCount(): number {
    try {
      return problems.openCount();
    } catch {
      return 0;
    }
  }

  function countOf(table: AnySQLiteTable): number {
    try {
      const row = db
        .select({ c: sql<number>`count(*)` })
        .from(table)
        .get();
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  }

  function lastJobStatus(jobId: string): "ok" | "error" | null {
    try {
      const row = db
        .select({ status: jobRuns.status, finishedAt: jobRuns.finishedAt })
        .from(jobRuns)
        .where(eq(jobRuns.jobId, jobId))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1)
        .get();
      if (!row) return null;
      if (row.finishedAt == null) return null; // still running
      if (row.finishedAt < Date.now() - STATUS_FRESHNESS_MS) return null;
      if (row.status === "ok" || row.status === "completed" || row.status === "success") return "ok";
      if (row.status === "running") return null;
      return "error";
    } catch {
      return null;
    }
  }

  /**
   * "error" when any enabled job's latest finished run failed, "ok" when they
   * all succeeded, null when nothing has finished within the freshness window.
   *
   * This was `lastJobStatus("healthcheck")`, which made the Jobs dot a
   * healthcheck dot: a poster refresh that failed four days earlier left it
   * green the whole time. A cancelled run is someone's decision, not a fault,
   * so a job's latest run is its latest that completed or failed. A disabled
   * job is left out — its last failure is no longer anything to act on.
   */
  function jobsHealth(): "ok" | "error" | null {
    try {
      const cutoff = Date.now() - STATUS_FRESHNESS_MS;
      const rows = db
        .select({ status: jobRuns.status })
        .from(jobs)
        .innerJoin(
          jobRuns,
          sql`${jobRuns.id} = (
            SELECT id FROM job_runs latest
            WHERE latest.job_id = ${jobs.id} AND latest.status IN ('completed', 'failed')
            ORDER BY latest.started_at DESC LIMIT 1
          )`,
        )
        .where(sql`${jobs.enabled} = 1 AND ${jobRuns.finishedAt} >= ${cutoff}`)
        .all();
      if (rows.length === 0) return null;
      return rows.some((r) => r.status === "failed") ? "error" : "ok";
    } catch {
      return null;
    }
  }

  function recentErrorEventCount(windowMs: number): number {
    try {
      const since = Date.now() - windowMs;
      const row = db
        .select({ c: sql<number>`count(*)` })
        .from(events)
        .where(sql`${events.timestamp} >= ${since} AND (${events.type} = 'error' OR ${events.type} LIKE '%.error')`)
        .get();
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  }

  /** Everything downloading, summed across instances. */
  function arrQueueCount(): number {
    try {
      const row = db
        .select({ c: sql<number>`coalesce(sum(queue_count), 0)` })
        .from(arrSyncState)
        .get();
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * "error" when any configured instance last failed, "ok" when they all
   * succeeded, null when none is configured — which is what keeps the dot off
   * the sidebar entirely on an install that does not use *Arrs.
   */
  function arrHealth(): "ok" | "error" | null {
    try {
      const rows = db.select({ lastError: arrSyncState.lastError }).from(arrSyncState).all();
      if (rows.length === 0) return null;
      return rows.some((r) => r.lastError) ? "error" : "ok";
    } catch {
      return null;
    }
  }

  const navRouter = t.router({
    /**
     * Single batched query for the sidebar's per-item metrics. Counts use
     * cheap `COUNT(*)`s; statuses come from the most recent finished job
     * run within the freshness window. One round-trip for the whole nav.
     */
    metrics: procedure.output(NativeAdmin.NavMetricsOutput).query(() => {
      return {
        collections: countOf(collections),
        media: countOf(mediaItems),
        rules: countOf(rules),
        users: countOf(plexUsers),
        prerolls: countOf(prerolls),
        eventsErrors24h: recentErrorEventCount(DAY_MS),
        // Items due now or on the very next run. A count of everything queued
        // would sit at a permanent non-zero and stop meaning anything.
        cleanupDueSoon: safeDueSoonCount(),
        overlaysStatus: lastJobStatus("overlays"),
        jobsStatus: jobsHealth(),
        // Read from `arr_sync_state`, which the sync and the poller keep
        // current. Deliberately *not* a fan-out to every configured *Arr:
        // the nav renders on every page load, and one unreachable instance
        // must not be able to make the whole app feel broken.
        arrQueue: arrQueueCount(),
        arrsStatus: arrHealth(),
        problems: safeProblemCount(),
      };
    }),
  });

  return navRouter;
}
