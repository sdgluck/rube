/**
 * Pure-read query helpers for the jobs/job_runs tables. Pulled out of
 * runner.ts so the lifecycle code doesn't share a file with persistence
 * formatting (GET-122).
 */
import { and, eq, desc, inArray, sql, type InferSelectModel } from "drizzle-orm";
import { db, jobs, jobRuns } from "@tinkerbell/db";
import { ACTIVE_RUN_STATUSES } from "./statuses.ts";

type Job = InferSelectModel<typeof jobs>;
type JobRun = InferSelectModel<typeof jobRuns>;

export function getJobs(): Array<
  Job & { lastRunStatus?: string | null; lastRunStartedAt?: number | null; lastRunId?: string | null }
> {
  return db
    .select({
      id: jobs.id,
      name: jobs.name,
      command: jobs.command,
      schedule: jobs.schedule,
      enabled: jobs.enabled,
      config: jobs.config,
      lastRunStatus: sql<string | null>`lr.status`.as("lastRunStatus"),
      lastRunStartedAt: sql<number | null>`lr.started_at`.as("lastRunStartedAt"),
      lastRunId: sql<string | null>`lr.id`.as("lastRunId"),
    })
    .from(jobs)
    .leftJoin(
      sql`job_runs lr`,
      sql`lr.id = (SELECT id FROM job_runs WHERE job_id = ${jobs.id} ORDER BY started_at DESC LIMIT 1)`,
    )
    .orderBy(jobs.id)
    .all();
}

export function getJobRuns(jobId: string, limit = 20): Array<Omit<JobRun, "log">> {
  return db
    .select({
      id: jobRuns.id,
      jobId: jobRuns.jobId,
      status: jobRuns.status,
      progress: jobRuns.progress,
      message: jobRuns.message,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
    })
    .from(jobRuns)
    .where(eq(jobRuns.jobId, jobId))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit)
    .all();
}

/**
 * When a job last finished successfully, or null if it never has.
 *
 * Cleanup uses this to decide whether the local library index is fresh enough
 * to act on: "nobody has watched this" is exactly the claim that goes wrong
 * against stale data, and a scheduled deletion built on it is the worst place
 * to find that out.
 */
export function lastSuccessfulRunAt(jobId: string): number | null {
  const row = db
    .select({ finishedAt: jobRuns.finishedAt })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "completed")))
    .orderBy(desc(jobRuns.finishedAt))
    .limit(1)
    .get();
  return row?.finishedAt ?? null;
}

/**
 * Run metadata *without* the log.
 *
 * The log is fetched separately and incrementally (`getJobRunLog`) because the
 * UI polls this once a second while a run is live, and re-serialising a
 * multi-megabyte log over tRPC every second is the single most expensive thing
 * the API used to do.
 */
export function getJobRun(runId: string): Omit<JobRun, "log"> | null {
  return (
    db
      .select({
        id: jobRuns.id,
        jobId: jobRuns.jobId,
        status: jobRuns.status,
        progress: jobRuns.progress,
        message: jobRuns.message,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
      })
      .from(jobRuns)
      .where(eq(jobRuns.id, runId))
      .get() ?? null
  );
}

/**
 * A slice of a run's log starting at `offset`.
 *
 * SQLite's `substr`/`length` do the slicing server-side, so a poll costs what
 * was appended since the last poll rather than the whole column. Callers
 * accumulate the chunks; `size` lets them detect a truncated/reset log and
 * start over.
 *
 * Offsets are **codepoints**, not JS string indices. SQLite counts characters,
 * JS's `.length` counts UTF-16 code units, and every astral character (an emoji
 * in a Plex collection title, say) makes the two disagree by one. Advancing the
 * caller by `chunk.length` would step past unread output and silently drop it.
 */
export function getJobRunLog(runId: string, offset = 0): { chunk: string; nextOffset: number; size: number } | null {
  const from = Math.max(0, Math.floor(offset));
  const row = db
    .select({
      // substr() is 1-indexed, and counts characters.
      chunk: sql<string>`substr(${jobRuns.log}, ${from + 1})`,
      size: sql<number>`length(${jobRuns.log})`,
    })
    .from(jobRuns)
    .where(eq(jobRuns.id, runId))
    .get();
  if (!row) return null;
  const chunk = row.chunk ?? "";
  // Spread iterates codepoints, matching how SQLite counted `size`.
  return { chunk, nextOffset: from + [...chunk].length, size: row.size ?? 0 };
}

/** The complete log, for the download affordance. */
export function getJobRunFullLog(runId: string): string | null {
  const row = db.select({ log: jobRuns.log }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
  return row?.log ?? null;
}

export function getActiveRuns(): Array<{
  id: string;
  jobId: string;
  jobName: string;
  status: string;
  progress: number;
  message: string;
  startedAt: number;
}> {
  return db
    .select({
      id: jobRuns.id,
      jobId: jobRuns.jobId,
      jobName: jobs.name,
      // `cancelling` runs are still active: the command hasn't unwound yet, so
      // the UI should keep showing them (as "Cancelling…") rather than have
      // them vanish and reappear in the recent list.
      status: jobRuns.status,
      progress: jobRuns.progress,
      message: jobRuns.message,
      startedAt: jobRuns.startedAt,
    })
    .from(jobRuns)
    .innerJoin(jobs, eq(jobs.id, jobRuns.jobId))
    .where(inArray(jobRuns.status, [...ACTIVE_RUN_STATUSES]))
    .orderBy(jobRuns.startedAt)
    .all();
}

export function getRecentRuns(limit = 8): Array<{
  id: string;
  jobId: string;
  jobName: string;
  status: string;
  progress: number;
  message: string;
  startedAt: number;
  finishedAt: number | null;
}> {
  return db
    .select({
      id: jobRuns.id,
      jobId: jobRuns.jobId,
      jobName: jobs.name,
      status: jobRuns.status,
      progress: jobRuns.progress,
      message: jobRuns.message,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
    })
    .from(jobRuns)
    .innerJoin(jobs, eq(jobs.id, jobRuns.jobId))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit)
    .all();
}
