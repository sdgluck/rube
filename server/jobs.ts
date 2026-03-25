import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { eq, and, ne, lt, desc, sql, type InferSelectModel } from "drizzle-orm";
import { Cron } from "croner";
import { seedDefaultRules } from "./rules.ts";
import { db } from "./db/index.ts";
import { jobs, jobRuns } from "./db/schema.ts";
import { emitEvent } from "./events.ts";
import { pruneHealthChecks, checkAllConfiguredServices } from "./health.ts";
import { syncRecentlyAdded, syncMostWatched } from "./stats.ts";
import { markStaleStressTestsAsFailed } from "./stress-test.ts";

type Job = InferSelectModel<typeof jobs>;
type JobRun = InferSelectModel<typeof jobRuns>;

const DEFAULT_JOBS: Omit<Job, "config">[] = [
  { id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "0 0 * * *", enabled: 1 },
  { id: "sync-collections", name: "Sync Collections", command: "sync-collections", schedule: "0 0 * * *", enabled: 1 },
  { id: "generate", name: "Generate Collections", command: "generate", schedule: "0 1 * * *", enabled: 1 },
  {
    id: "because-you-watched",
    name: "Because You Watched",
    command: "because-you-watched",
    schedule: "0 2 * * *",
    enabled: 1,
  },
  { id: "shuffle", name: "Shuffle Hubs", command: "shuffle", schedule: "*/30 * * * *", enabled: 1 },
  { id: "purge-runs", name: "Purge Old Runs", command: "purge-runs", schedule: "0 3 * * *", enabled: 1 },
  { id: "label", name: "Sync Labels", command: "label", schedule: "", enabled: 1 },
  { id: "label-undo", name: "Undo Labels", command: "label-undo", schedule: "", enabled: 1 },
  { id: "overlays", name: "Apply Overlays", command: "overlays", schedule: "", enabled: 1 },
  { id: "overlays-remove", name: "Remove Overlays", command: "overlays", schedule: "", enabled: 1 },
  {
    id: "sync-recently-added",
    name: "Sync Recently Added",
    command: "sync-recently-added",
    schedule: "*/15 * * * *",
    enabled: 1,
  },
  {
    id: "sync-most-watched",
    name: "Sync Most Watched",
    command: "sync-most-watched",
    schedule: "0 * * * *",
    enabled: 1,
  },
  { id: "sync-users", name: "Sync Plex Users", command: "sync-users", schedule: "0 */6 * * *", enabled: 1 },
  { id: "healthcheck", name: "Healthcheck", command: "healthcheck", schedule: "* * * * *", enabled: 1 },
];

const DEFAULT_CONFIGS: Record<string, string> = {
  "because-you-watched": '{"limit":10}',
  "overlays-remove": '{"mode":"remove"}',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const cronJobs = new Map<string, Cron>();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Internal jobs run in-process without the command pattern
const internalJobs: Record<string, () => string | Promise<string>> = {
  "purge-runs": () => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
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

const REMOVED_JOBS = ["sync-sections", "stress-test"];

function seedDefaultJobs(): void {
  let inserted = 0;
  for (const job of DEFAULT_JOBS) {
    const configJson = DEFAULT_CONFIGS[job.id] || "{}";
    const result = db
      .insert(jobs)
      .values({ ...job, config: configJson })
      .onConflictDoNothing()
      .run();
    if (result.changes > 0) inserted++;
  }
  if (inserted > 0) {
    console.log(`[jobs] Seeded ${inserted} new default job(s)`);
  }

  // Clean up removed default jobs (delete runs first due to FK constraint)
  for (const id of REMOVED_JOBS) {
    db.delete(jobRuns).where(eq(jobRuns.jobId, id)).run();
    db.delete(jobs).where(eq(jobs.id, id)).run();
  }
}

function markStaleRunsAsFailed(): void {
  const result = db
    .update(jobRuns)
    .set({ status: "failed", finishedAt: Date.now() })
    .where(eq(jobRuns.status, "running"))
    .run();
  if (result.changes > 0) {
    console.log(`[jobs] Marked ${result.changes} stale running run(s) as failed`);
  }
}

function startCronSchedules(): void {
  const enabledJobs = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.enabled, 1), ne(jobs.schedule, "")))
    .all();
  for (const job of enabledJobs) {
    scheduleCron(job);
  }
  console.log(`[jobs] Started ${enabledJobs.length} cron schedule(s)`);
}

function scheduleCron(job: Pick<Job, "id" | "name" | "enabled" | "schedule">): void {
  const existing = cronJobs.get(job.id);
  if (existing) {
    existing.stop();
    cronJobs.delete(job.id);
  }

  if (!job.enabled || !job.schedule) return;

  const cron = new Cron(job.schedule, () => {
    console.log(`[jobs] Cron triggered: ${job.name}`);
    startJob(job.id).catch((err) => console.error(`[jobs] Failed to start ${job.name}:`, err));
  });
  cronJobs.set(job.id, cron);
}

async function startSidequest(): Promise<void> {
  const { Sidequest } = await import("sidequest");
  const dbPath = join(process.env.DATA_DIR || join(import.meta.dirname, ".."), "sidequest.sqlite");
  await Sidequest.start({
    backend: { driver: "@sidequest/sqlite-backend", config: dbPath },
    queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
    maxConcurrentJobs: 1,
    manualJobResolution: true,
    jobsFilePath: join(import.meta.dirname, "sidequest-registry.ts"),
    gracefulShutdown: true,
    logger: { level: "warn" },
  });
  console.log("[jobs] Sidequest engine started");
}

export async function stopSidequest(): Promise<void> {
  try {
    const { Sidequest } = await import("sidequest");
    await Sidequest.stop();
    console.log("[jobs] Sidequest engine stopped");
  } catch {
    // Engine may not have started
  }
}

export async function startJob(jobId: string): Promise<{ runId: string } | null> {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return null;

  const runId = randomUUID();
  const now = Date.now();

  // Atomic insert — prevents race condition where two concurrent requests
  // both see no running job and both insert
  const result = db.run(sql`
    INSERT INTO job_runs (id, job_id, status, log, progress, message, started_at)
    SELECT ${runId}, ${jobId}, 'running', '', 0, '', ${now}
    WHERE NOT EXISTS (
      SELECT 1 FROM job_runs WHERE job_id = ${jobId} AND status = 'running'
    )
  `);
  if (result.changes === 0) return null;

  // Clean up old runs (keep last 50)
  const keepIds = db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(eq(jobRuns.jobId, jobId))
    .orderBy(desc(jobRuns.startedAt))
    .limit(50)
    .all()
    .map((r) => r.id);

  if (keepIds.length >= 50) {
    db.delete(jobRuns)
      .where(
        and(
          eq(jobRuns.jobId, jobId),
          sql`${jobRuns.id} NOT IN (${sql.join(
            keepIds.map((id) => sql`${id}`),
            sql`,`,
          )})`,
        ),
      )
      .run();
  }

  // Internal jobs run in-process without the command pattern
  const internalHandler = internalJobs[job.command];
  if (internalHandler) {
    console.log(`[jobs] Running internal job: ${job.name}`);
    try {
      const output = await internalHandler();
      db.update(jobRuns)
        .set({ status: "completed", log: output, progress: 1, message: output, finishedAt: Date.now() })
        .where(eq(jobRuns.id, runId))
        .run();
      emitEvent("job.completed", `${job.name} completed in ${formatDuration(Date.now() - now)}`, { jobId: job.id });
      console.log(`[jobs] ${job.name} completed: ${output}`);
    } catch (err) {
      const msg = (err as Error).message;
      db.update(jobRuns)
        .set({ status: "failed", log: msg, message: msg, finishedAt: Date.now() })
        .where(eq(jobRuns.id, runId))
        .run();
      emitEvent("job.failed", `${job.name} failed: ${msg}`, { jobId: job.id });
      console.error(`[jobs] ${job.name} failed: ${msg}`);
    }
    return { runId };
  }

  // Command jobs → enqueue via Sidequest worker thread
  console.log(`[jobs] Enqueueing ${job.name} via Sidequest`);
  const { Sidequest } = await import("sidequest");
  const { CommandJob } = await import("./sidequest-job.ts");
  await Sidequest.build(CommandJob).enqueue(job.command, runId, job.config || "{}", job.name, job.id);

  return { runId };
}

export function cancelRun(runId: string): boolean {
  const run = db.select({ id: jobRuns.id, status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
  if (!run || run.status !== "running") return false;

  db.update(jobRuns).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(jobRuns.id, runId)).run();

  return true;
}

export function getJobs(): Array<
  Job & { lastRunStatus?: string | null; lastRunStartedAt?: number | null; lastRunId?: string | null }
> {
  const rows = db
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
  return rows;
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

export function updateJob(
  jobId: string,
  updates: { schedule?: string; enabled?: boolean; config?: Record<string, unknown> },
): void {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new Error(`Job "${jobId}" not found`);

  if (updates.schedule !== undefined) {
    // Validate cron expression (throws if invalid)
    if (updates.schedule) {
      new Cron(updates.schedule);
    }
    db.update(jobs).set({ schedule: updates.schedule }).where(eq(jobs.id, jobId)).run();
    job.schedule = updates.schedule;
  }

  if (updates.enabled !== undefined) {
    const val = updates.enabled ? 1 : 0;
    db.update(jobs).set({ enabled: val }).where(eq(jobs.id, jobId)).run();
    job.enabled = val;
  }

  if (updates.config !== undefined) {
    db.update(jobs)
      .set({ config: JSON.stringify(updates.config) })
      .where(eq(jobs.id, jobId))
      .run();
  }

  // Reschedule cron
  scheduleCron(job);
}

export async function initJobs(): Promise<void> {
  seedDefaultJobs();
  seedDefaultRules();
  markStaleRunsAsFailed();
  markStaleStressTestsAsFailed();
  await startSidequest();
  startCronSchedules();
}
