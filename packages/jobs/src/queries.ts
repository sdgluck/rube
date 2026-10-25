import { type Services } from "@rube/composition";
/**
 * Pure-read query helpers for the jobs/job_runs tables. Pulled out of
 * runner.ts so the lifecycle code doesn't share a file with persistence
 * formatting (GET-122).
 */
import { and, eq, desc, inArray, sql, type InferSelectModel } from "drizzle-orm";
import { jobs, jobRuns } from "@rube/db";
import { ACTIVE_RUN_STATUSES } from "./statuses.ts";
import { QUIET_INTERNAL_JOBS } from "./internal-jobs.ts";

type Job = InferSelectModel<typeof jobs>;
type JobRun = InferSelectModel<typeof jobRuns>;

export function createQueries(deps: Pick<Services, "db">) {
  const { db } = deps;

  function getJobs(): Array<
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

  function getJobRuns(jobId: string, limit = 20): Array<Omit<JobRun, "log">> {
    return db
      .select({
        id: jobRuns.id,
        jobId: jobRuns.jobId,
        status: jobRuns.status,
        progress: jobRuns.progress,
        message: jobRuns.message,
        failureKind: jobRuns.failureKind,
        variant: jobRuns.variant,
        startedAt: jobRuns.startedAt,
        claimedAt: jobRuns.claimedAt,
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
  function lastSuccessfulRunAt(jobId: string): number | null {
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
  function getJobRun(runId: string): (Omit<JobRun, "log"> & { jobName: string | null; command: string | null }) | null {
    return (
      db
        .select({
          id: jobRuns.id,
          jobId: jobRuns.jobId,
          // For the run page's breadcrumb and variant label, which used to show
          // the raw job id because this was all it had.
          jobName: jobs.name,
          command: jobs.command,
          status: jobRuns.status,
          progress: jobRuns.progress,
          message: jobRuns.message,
          failureKind: jobRuns.failureKind,
          variant: jobRuns.variant,
          startedAt: jobRuns.startedAt,
          claimedAt: jobRuns.claimedAt,
          finishedAt: jobRuns.finishedAt,
        })
        .from(jobRuns)
        .leftJoin(jobs, eq(jobs.id, jobRuns.jobId))
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
  function getJobRunLog(runId: string, offset = 0): { chunk: string; nextOffset: number; size: number } | null {
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
  function getJobRunFullLog(runId: string): string | null {
    const row = db.select({ log: jobRuns.log }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
    return row?.log ?? null;
  }

  function getActiveRuns(): Array<{
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

  /**
   * The newest runs across every job, less the routine ones.
   *
   * A routine run is a quiet job's completed run that said exactly what that
   * job's previous run said — the same test the runner uses to keep it out of
   * the events feed. Without it the pollers own the list: `playback-poll`
   * every 30s and `healthcheck`, `rule-schedules` and `arr-poll` every minute
   * filled forty rows in seven minutes, and the panel's rollup only merges
   * runs that sit next to each other, which interleaved pollers never do. A
   * failure, or a poll that found something, still shows. Filtered before the
   * limit, so the list reaches back to the work that mattered.
   */
  function getRecentRuns(limit = 8): Array<{
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
      .where(
        sql`NOT (${jobRuns.status} = 'completed'
          AND ${jobs.command} IN (${sql.join(
            QUIET_INTERNAL_JOBS.map((c) => sql`${c}`),
            sql`, `,
          )})
          AND ${jobRuns.message} IS (
            SELECT prev.message FROM job_runs prev
            WHERE prev.job_id = ${jobRuns.jobId} AND prev.started_at < ${jobRuns.startedAt}
            ORDER BY prev.started_at DESC LIMIT 1
          ))`,
      )
      .orderBy(desc(jobRuns.startedAt))
      .limit(limit)
      .all();
  }

  /**
   * Every run that overlapped the last `windowMs`, for the timeline.
   *
   * Overlapped, not started in — a four-hour Generate that began at 23:00 is the
   * most interesting bar on a 24-hour view and the one a `startedAt >= cutoff`
   * filter would drop.
   *
   * `finishedAt` is null for a run still going, which the timeline draws as
   * running to "now" rather than as zero-width.
   */
  function getRunsInWindow(
    windowMs: number,
    now = Date.now(),
  ): Array<{
    id: string;
    jobId: string;
    jobName: string;
    command: string;
    status: string;
    message: string;
    failureKind: string | null;
    variant: string | null;
    startedAt: number;
    finishedAt: number | null;
  }> {
    const cutoff = now - windowMs;
    return db
      .select({
        id: jobRuns.id,
        jobId: jobRuns.jobId,
        jobName: jobs.name,
        command: jobs.command,
        status: jobRuns.status,
        message: jobRuns.message,
        failureKind: jobRuns.failureKind,
        variant: jobRuns.variant,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
      })
      .from(jobRuns)
      .innerJoin(jobs, eq(jobs.id, jobRuns.jobId))
      .where(sql`COALESCE(${jobRuns.finishedAt}, ${now}) >= ${cutoff}`)
      .orderBy(jobRuns.startedAt)
      .all();
  }

  /**
   * How long each job usually takes: the median of its recent completed runs.
   *
   * What the schedule page draws as a block's width, and what the presets pack
   * by. A median rather than a mean because one cold-cache `generate` after an
   * upgrade shouldn't push the whole night back, and completed runs only
   * because a failure's duration is how long it took to fail.
   *
   * Run history is kept for about a week, so a daily job has at most seven
   * samples and a weekly one a single run — the page says when a width is an
   * estimate rather than a measurement.
   */
  function typicalDurations(perJob = 20): Record<string, { medianMs: number; p90Ms: number; samples: number }> {
    const rows = db
      .select({ jobId: jobRuns.jobId, startedAt: jobRuns.startedAt, finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.status, "completed"), sql`${jobRuns.finishedAt} IS NOT NULL`))
      .orderBy(desc(jobRuns.startedAt))
      .all();
    const byJob = new Map<string, number[]>();
    for (const row of rows) {
      const list = byJob.get(row.jobId) ?? [];
      if (list.length >= perJob) continue;
      list.push(Math.max(0, (row.finishedAt ?? row.startedAt) - row.startedAt));
      byJob.set(row.jobId, list);
    }
    const out: Record<string, { medianMs: number; p90Ms: number; samples: number }> = {};
    for (const [jobId, durations] of byJob) {
      const sorted = durations.sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      out[jobId] = { medianMs: at(0.5), p90Ms: at(0.9), samples: sorted.length };
    }
    return out;
  }

  return {
    typicalDurations,
    getJobs,
    getJobRuns,
    lastSuccessfulRunAt,
    getJobRun,
    getJobRunLog,
    getJobRunFullLog,
    getActiveRuns,
    getRecentRuns,
    getRunsInWindow,
  };
}
