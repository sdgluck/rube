import { desc, eq, sql } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { db, collections, mediaItems, rules, plexUsers, jobRuns, events } from "@tinkerbell/db";
import { DAY_MS, WEEK_MS } from "@tinkerbell/core";
import { t, procedure } from "./_base.ts";

/**
 * Fresh-status threshold: a tick / cross next to a sidebar item is only
 * meaningful if the underlying job ran recently. Anything older than this
 * surfaces as `null` so we render nothing instead of a stale ✓.
 */
const STATUS_FRESHNESS_MS = WEEK_MS;

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

export const navRouter = t.router({
  /**
   * Single batched query for the sidebar's per-item metrics. Counts use
   * cheap `COUNT(*)`s; statuses come from the most recent finished job
   * run within the freshness window. One round-trip for the whole nav.
   */
  metrics: procedure.query(() => {
    return {
      collections: countOf(collections),
      media: countOf(mediaItems),
      rules: countOf(rules),
      users: countOf(plexUsers),
      eventsErrors24h: recentErrorEventCount(DAY_MS),
      overlaysStatus: lastJobStatus("overlays"),
      jobsStatus: lastJobStatus("healthcheck"),
    };
  }),
});
