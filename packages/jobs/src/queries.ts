/**
 * Pure-read query helpers for the jobs/job_runs tables. Pulled out of
 * runner.ts so the lifecycle code doesn't share a file with persistence
 * formatting (GET-122).
 */
import { eq, desc, sql, type InferSelectModel } from "drizzle-orm";
import { db, jobs, jobRuns } from "@tinkerbell/db";

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

export function getJobRun(runId: string): JobRun | null {
  return db.select().from(jobRuns).where(eq(jobRuns.id, runId)).get() ?? null;
}

export function getActiveRuns(): Array<{
  id: string;
  jobId: string;
  jobName: string;
  progress: number;
  message: string;
  startedAt: number;
}> {
  return db
    .select({
      id: jobRuns.id,
      jobId: jobRuns.jobId,
      jobName: jobs.name,
      progress: jobRuns.progress,
      message: jobRuns.message,
      startedAt: jobRuns.startedAt,
    })
    .from(jobRuns)
    .innerJoin(jobs, eq(jobs.id, jobRuns.jobId))
    .where(eq(jobRuns.status, "running"))
    .orderBy(jobRuns.startedAt)
    .all();
}

export function getRecentRuns(): Array<{
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
    .limit(8)
    .all();
}
