import { randomUUID } from "node:crypto";
import { eq, and, ne, lt, desc, sql, type InferSelectModel } from "drizzle-orm";
import { Cron } from "croner";
import { getConfig } from "./config.ts";
import { seedDefaultRules } from "./rules.ts";
import { db } from "./db/index.ts";
import { jobs, jobRuns } from "./db/schema.ts";
import { emitEvent } from "./events.ts";
import type {
  JobContext,
  CommonJobConfig,
  GenerateJobConfig,
  BywJobConfig,
  OverlaysJobConfig,
} from "../shared/job-context.ts";

type Job = InferSelectModel<typeof jobs>;
type JobRun = InferSelectModel<typeof jobRuns>;

const DEFAULT_JOBS: Omit<Job, "config">[] = [
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
];

const DEFAULT_CONFIGS: Record<string, string> = {
  "because-you-watched": '{"limit":10}',
  "overlays-remove": '{"mode":"remove"}',
};

// Command registry — maps command name to its run function
const commandRegistry: Record<
  string,
  (ctx: JobContext, config: CommonJobConfig | GenerateJobConfig | BywJobConfig | OverlaysJobConfig) => Promise<void>
> = {};

async function loadCommand(name: string) {
  if (commandRegistry[name]) return;
  switch (name) {
    case "shuffle": {
      const mod = await import("./commands/shuffle.ts");
      commandRegistry[name] = mod.default;
      break;
    }
    case "generate": {
      const mod = await import("./commands/generate.ts");
      commandRegistry[name] = mod.default;
      break;
    }
    case "because-you-watched": {
      const mod = await import("./commands/because-you-watched.ts");
      commandRegistry[name] = mod.default;
      break;
    }
    case "sync-collections": {
      const mod = await import("./commands/sync-collections.ts");
      commandRegistry[name] = mod.default;
      break;
    }
    case "label": {
      const mod = await import("./commands/label.ts");
      commandRegistry[name] = mod.default;
      break;
    }
    case "label-undo": {
      const mod = await import("./commands/label-undo.ts");
      commandRegistry[name] = mod.default;
      break;
    }
    case "overlays": {
      const mod = await import("./commands/overlays.ts");
      commandRegistry[name] = mod.default;
      break;
    }
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const activeControllers = new Map<string, AbortController>();
const cronJobs = new Map<string, Cron>();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Internal jobs run in-process without the command pattern
const internalJobs: Record<string, () => string> = {
  "purge-runs": () => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const result = db
      .delete(jobRuns)
      .where(and(ne(jobRuns.status, "running"), lt(jobRuns.startedAt, cutoff)))
      .run();
    return `Purged ${result.changes} job run(s) older than 7 days.`;
  },
};

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
    startJob(job.id);
  });
  cronJobs.set(job.id, cron);
}

export function startJob(jobId: string): { runId: string; done: Promise<void> } | null {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return null;

  // Prevent duplicate runs
  const existing = db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "running")))
    .get();
  if (existing) return null;

  const runId = randomUUID();
  const now = Date.now();

  db.insert(jobRuns)
    .values({ id: runId, jobId, status: "running", log: "", progress: 0, message: "", startedAt: now })
    .run();

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
    const done = Promise.resolve().then(() => {
      try {
        const output = internalHandler();
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
    });
    return { runId, done };
  }

  // Command jobs run in-process via the command registry
  const controller = new AbortController();
  activeControllers.set(runId, controller);

  let logBuffer = "";
  let progress = 0;
  let message = "";
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  function flushLog(): void {
    if (logBuffer.length === 0) return;
    try {
      const currentRow = db.select({ log: jobRuns.log }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
      const currentLog = currentRow?.log ?? "";
      db.update(jobRuns)
        .set({ log: currentLog + logBuffer, progress, message })
        .where(eq(jobRuns.id, runId))
        .run();
      logBuffer = "";
    } catch {
      // DB may be closed during shutdown
    }
  }

  const ctx: JobContext = {
    log: (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
      logBuffer += text;
      // Update message to the last non-empty log line
      const trimmed = text.trim();
      if (trimmed) message = trimmed;
    },
    progress: (current: number, total: number, msg: string) => {
      progress = total > 0 ? (current - 1) / total : 0;
      message = msg;
    },
    signal: controller.signal,
  };

  // Parse per-job config
  let jobConfig: Record<string, unknown> = {};
  try {
    jobConfig = JSON.parse(job.config || "{}");
  } catch {
    // Invalid config, use empty
  }

  flushTimer = setInterval(flushLog, 500);

  console.log(`[jobs] Starting ${job.name} (in-process)`);

  const done = (async () => {
    try {
      await loadCommand(job.command);
      const commandFn = commandRegistry[job.command];
      if (!commandFn) {
        throw new Error(`Unknown command: ${job.command}`);
      }
      await commandFn(ctx, jobConfig as CommonJobConfig);

      if (flushTimer) clearInterval(flushTimer);
      flushLog();

      const wasCancelled = !activeControllers.has(runId);
      activeControllers.delete(runId);

      if (!wasCancelled) {
        try {
          db.update(jobRuns)
            .set({ status: "completed", progress: 1, finishedAt: Date.now() })
            .where(eq(jobRuns.id, runId))
            .run();
          emitEvent("job.completed", `${job.name} completed in ${formatDuration(Date.now() - now)}`, { jobId: job.id });
        } catch {
          // DB may be closed
        }
        console.log(`[jobs] ${job.name} completed`);
      }
    } catch (err) {
      if (flushTimer) clearInterval(flushTimer);

      const wasCancelled = !activeControllers.has(runId);
      activeControllers.delete(runId);

      if (wasCancelled) {
        // Already marked as cancelled by cancelRun()
        return;
      }

      const errorMsg = (err as Error).message;
      logBuffer += `\nError: ${errorMsg}\n`;
      flushLog();

      try {
        db.update(jobRuns).set({ status: "failed", finishedAt: Date.now() }).where(eq(jobRuns.id, runId)).run();
        emitEvent("job.failed", `${job.name} failed: ${errorMsg}`, { jobId: job.id });
      } catch {
        // DB may be closed
      }
      console.error(`[jobs] ${job.name} failed: ${errorMsg}`);
    }
  })();

  return { runId, done };
}

export function cancelRun(runId: string): boolean {
  const controller = activeControllers.get(runId);
  if (!controller) return false;

  // Remove from map first so the job handler knows it was cancelled
  activeControllers.delete(runId);
  controller.abort();

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

export function initJobs(): void {
  seedDefaultJobs();
  seedDefaultRules();
  markStaleRunsAsFailed();
  startCronSchedules();
}
