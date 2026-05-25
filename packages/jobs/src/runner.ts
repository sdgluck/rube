import { randomUUID } from "node:crypto";
import { errorMessage } from "@tinkerbell/core";
import { join } from "node:path";
import { eq, and, desc, notInArray, sql, type InferSelectModel } from "drizzle-orm";
import { Cron } from "croner";
import { seedDefaultRules } from "@tinkerbell/domain.rules";
import { db, jobs, jobRuns } from "@tinkerbell/db";
import { emitEvent } from "@tinkerbell/domain.events";
import { markStaleStressTestsAsFailed } from "./stress-test/index.ts";
import { internalJobs } from "./internal-jobs.ts";
import { initSchedule, scheduleCron, startCronSchedules } from "./schedule.ts";
import { JOB_RUN_KEEP_PER_JOB } from "./limits.ts";

type Job = InferSelectModel<typeof jobs>;

// System + always-seeded background/escape-hatch jobs. Features are NOT here
// — they're created on demand via installFeature(). See FEATURE_TEMPLATES.
const DEFAULT_JOBS: Omit<Job, "config">[] = [
  // ── System (infrastructure) ─────────────────────────────────────────────
  { id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "0 0 * * *", enabled: 1 },
  { id: "sync-collections", name: "Sync Collections", command: "sync-collections", schedule: "0 0 * * *", enabled: 1 },
  { id: "generate", name: "Generate Collections", command: "generate", schedule: "0 1 * * *", enabled: 1 },
  { id: "purge-runs", name: "Purge Old Runs", command: "purge-runs", schedule: "0 3 * * *", enabled: 1 },
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
  {
    id: "posters-refresh",
    name: "Refresh Poster Cache",
    command: "posters-refresh",
    schedule: "0 4 * * 0",
    enabled: 1,
  },
  // ── Background / escape-hatch (hidden from UI, invoked via Settings or BYW lifecycle) ──
  { id: "label", name: "Apply Collection Restrictions", command: "label", schedule: "", enabled: 1 },
  { id: "label-undo", name: "Clear Tinkerbell Labels", command: "label-undo", schedule: "", enabled: 1 },
  { id: "byw-remove", name: "Remove Because You Watched", command: "byw-remove", schedule: "", enabled: 1 },
  {
    id: "personalize-enable",
    name: "Enable Personalized Home Screens",
    command: "personalize-enable",
    schedule: "",
    enabled: 1,
  },
  {
    id: "personalize-disable",
    name: "Disable Personalized Home Screens",
    command: "personalize-disable",
    schedule: "",
    enabled: 1,
  },
  { id: "overlays-remove", name: "Remove Overlays", command: "overlays", schedule: "", enabled: 1 },
  // No schedule — only ever triggered explicitly from Settings → Migrate.
  // One job covers all migration providers; the providerId is read from
  // `migration_pending_plan` at run time.
  {
    id: "migrate-collections",
    name: "Migrate Collections",
    command: "migrate-collections",
    schedule: "",
    enabled: 1,
  },
];

const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  "overlays-remove": { mode: "remove" },
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const REMOVED_JOBS = ["sync-sections", "stress-test", "migrate-kometa"];

function seedDefaultJobs(): void {
  let inserted = 0;
  for (const job of DEFAULT_JOBS) {
    const result = db
      .insert(jobs)
      .values({ ...job, config: DEFAULT_CONFIGS[job.id] ?? {} })
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

async function startSidequest(): Promise<void> {
  const { Sidequest } = await import("sidequest");
  const dbPath = join(process.env.DATA_DIR || join(import.meta.dirname, "..", "..", "..", ".."), "sidequest.sqlite");
  await Sidequest.start({
    backend: { driver: "@sidequest/sqlite-backend", config: dbPath },
    queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
    maxConcurrentJobs: 1,
    manualJobResolution: true,
    jobsFilePath: join(import.meta.dirname, "sidequest", "registry.ts"),
    gracefulShutdown: true,
    logger: { level: "warn" },
  });
  console.log("[jobs] Sidequest engine started");
}

let shuttingDown = false;

/**
 * Set by `stopSidequest` so in-flight job code can decide whether a DB
 * write failure is just the engine tearing down (silent) or something
 * to actually log (everything else).
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

export async function stopSidequest(): Promise<void> {
  shuttingDown = true;
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

  // Clean up old runs (keep last JOB_RUN_KEEP_PER_JOB). SELECT + DELETE
  // are wrapped in a transaction so a concurrent insert between them
  // can't be deleted by our cleanup (off-by-one retention).
  db.transaction((tx) => {
    const keepIds = tx
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(eq(jobRuns.jobId, jobId))
      .orderBy(desc(jobRuns.startedAt))
      .limit(JOB_RUN_KEEP_PER_JOB)
      .all()
      .map((r) => r.id);

    if (keepIds.length >= JOB_RUN_KEEP_PER_JOB) {
      tx.delete(jobRuns)
        .where(and(eq(jobRuns.jobId, jobId), notInArray(jobRuns.id, keepIds)))
        .run();
    }
  });

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
      const msg = errorMessage(err);
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
  const { CommandJob } = await import("./sidequest/job.ts");
  await Sidequest.build(CommandJob).enqueue(job.command, runId, JSON.stringify(job.config ?? {}), job.name, job.id);

  return { runId };
}

export function cancelRun(runId: string): boolean {
  const run = db.select({ id: jobRuns.id, status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
  if (!run || run.status !== "running") return false;

  db.update(jobRuns).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(jobRuns.id, runId)).run();

  return true;
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
    db.update(jobs).set({ config: updates.config }).where(eq(jobs.id, jobId)).run();
  }

  // Reschedule cron
  scheduleCron(job);
}

export async function initJobs(): Promise<void> {
  // Wire startJob into the cron-trigger callback before any schedule
  // can fire. See schedule.ts for the dependency-inversion shape.
  initSchedule(startJob);
  seedDefaultJobs();
  seedDefaultRules();
  markStaleRunsAsFailed();
  markStaleStressTestsAsFailed();
  await startSidequest();
  startCronSchedules();
}
