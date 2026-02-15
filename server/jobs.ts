import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { getDb, getConfig } from "./config.ts";
import type { JobContext, CommonJobConfig, GenerateJobConfig, BywJobConfig } from "../shared/job-context.ts";

interface Job {
  id: string;
  name: string;
  command: string;
  schedule: string;
  enabled: number;
  config: string;
}

interface JobRun {
  id: string;
  job_id: string;
  status: string;
  log: string;
  progress: number;
  message: string;
  started_at: number;
  finished_at: number | null;
}

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
];

const DEFAULT_CONFIGS: Record<string, string> = {
  generate: '{"limit":8}',
  "because-you-watched": '{"limit":10}',
};

// Command registry — maps command name to its run function
const commandRegistry: Record<
  string,
  (ctx: JobContext, config: CommonJobConfig | GenerateJobConfig | BywJobConfig) => Promise<void>
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
  }
}

const activeControllers = new Map<string, AbortController>();
const cronJobs = new Map<string, Cron>();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Internal jobs run in-process without the command pattern
const internalJobs: Record<string, () => string> = {
  "purge-runs": () => {
    const db = getDb();
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const result = db.prepare("DELETE FROM job_runs WHERE status != 'running' AND started_at < ?").run(cutoff);
    return `Purged ${result.changes} job run(s) older than 7 days.`;
  },
};

function seedDefaultJobs(): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO jobs (id, name, command, schedule, enabled, config) VALUES (?, ?, ?, ?, ?, ?)",
  );
  let inserted = 0;
  for (const job of DEFAULT_JOBS) {
    const configJson = DEFAULT_CONFIGS[job.id] || "{}";
    const result = stmt.run(job.id, job.name, job.command, job.schedule, job.enabled, configJson);
    if (result.changes > 0) inserted++;
  }
  if (inserted > 0) {
    console.log(`[jobs] Seeded ${inserted} new default job(s)`);
  }
}

function markStaleRunsAsFailed(): void {
  const db = getDb();
  const result = db
    .prepare("UPDATE job_runs SET status = 'failed', finished_at = ? WHERE status = 'running'")
    .run(Date.now());
  if (result.changes > 0) {
    console.log(`[jobs] Marked ${result.changes} stale running run(s) as failed`);
  }
}

function startCronSchedules(): void {
  const db = getDb();
  const jobs = db.prepare("SELECT * FROM jobs WHERE enabled = 1 AND schedule != ''").all() as unknown as Job[];
  for (const job of jobs) {
    scheduleCron(job);
  }
  console.log(`[jobs] Started ${jobs.length} cron schedule(s)`);
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
  const db = getDb();

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) return null;

  // Prevent duplicate runs
  const existing = db.prepare("SELECT id FROM job_runs WHERE job_id = ? AND status = 'running'").get(jobId) as
    | { id: string }
    | undefined;
  if (existing) return null;

  const runId = randomUUID();
  const now = Date.now();

  db.prepare(
    "INSERT INTO job_runs (id, job_id, status, log, progress, message, started_at) VALUES (?, ?, 'running', '', 0, '', ?)",
  ).run(runId, jobId, now);

  // Clean up old runs (keep last 50)
  db.prepare(
    "DELETE FROM job_runs WHERE job_id = ? AND id NOT IN (SELECT id FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 50)",
  ).run(jobId, jobId);

  // Internal jobs run in-process without the command pattern
  const internalHandler = internalJobs[job.command];
  if (internalHandler) {
    console.log(`[jobs] Running internal job: ${job.name}`);
    const done = Promise.resolve().then(() => {
      try {
        const output = internalHandler();
        db.prepare(
          "UPDATE job_runs SET status = 'completed', log = ?, progress = 1, message = ?, finished_at = ? WHERE id = ?",
        ).run(output, output, Date.now(), runId);
        console.log(`[jobs] ${job.name} completed: ${output}`);
      } catch (err) {
        const msg = (err as Error).message;
        db.prepare("UPDATE job_runs SET status = 'failed', log = ?, message = ?, finished_at = ? WHERE id = ?").run(
          msg,
          msg,
          Date.now(),
          runId,
        );
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
      const currentLog =
        (db.prepare("SELECT log FROM job_runs WHERE id = ?").get(runId) as { log: string } | undefined)?.log ?? "";
      db.prepare("UPDATE job_runs SET log = ?, progress = ?, message = ? WHERE id = ?").run(
        currentLog + logBuffer,
        progress,
        message,
        runId,
      );
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
          db.prepare("UPDATE job_runs SET status = 'completed', progress = 1, finished_at = ? WHERE id = ?").run(
            Date.now(),
            runId,
          );
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
        db.prepare("UPDATE job_runs SET status = 'failed', finished_at = ? WHERE id = ?").run(Date.now(), runId);
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

  const db = getDb();
  db.prepare("UPDATE job_runs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), runId);

  return true;
}

export function getJobs(): Array<
  Job & { last_run_status?: string; last_run_started_at?: number; last_run_id?: string }
> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT j.*, lr.status AS last_run_status, lr.started_at AS last_run_started_at, lr.id AS last_run_id
       FROM jobs j
       LEFT JOIN job_runs lr ON lr.id = (
         SELECT id FROM job_runs WHERE job_id = j.id ORDER BY started_at DESC LIMIT 1
       )
       ORDER BY j.id`,
    )
    .all() as unknown as Array<Job & { last_run_status?: string; last_run_started_at?: number; last_run_id?: string }>;
  return rows;
}

export function getJobRuns(jobId: string, limit = 20): Array<Omit<JobRun, "log">> {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, job_id, status, progress, message, started_at, finished_at FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(jobId, limit) as Array<Omit<JobRun, "log">>;
}

export function getJobRun(runId: string): JobRun | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun | undefined;
  return row ?? null;
}

export function getActiveRuns(): Array<{
  id: string;
  job_id: string;
  job_name: string;
  progress: number;
  message: string;
  started_at: number;
}> {
  const db = getDb();
  return db
    .prepare(
      `SELECT jr.id, jr.job_id, j.name AS job_name, jr.progress, jr.message, jr.started_at
       FROM job_runs jr
       JOIN jobs j ON j.id = jr.job_id
       WHERE jr.status = 'running'
       ORDER BY jr.started_at`,
    )
    .all() as Array<{
    id: string;
    job_id: string;
    job_name: string;
    progress: number;
    message: string;
    started_at: number;
  }>;
}

export function updateJob(
  jobId: string,
  updates: { schedule?: string; enabled?: boolean; config?: Record<string, unknown> },
): void {
  const db = getDb();

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) throw new Error(`Job "${jobId}" not found`);

  if (updates.schedule !== undefined) {
    // Validate cron expression (throws if invalid)
    if (updates.schedule) {
      new Cron(updates.schedule);
    }
    db.prepare("UPDATE jobs SET schedule = ? WHERE id = ?").run(updates.schedule, jobId);
    job.schedule = updates.schedule;
  }

  if (updates.enabled !== undefined) {
    db.prepare("UPDATE jobs SET enabled = ? WHERE id = ?").run(updates.enabled ? 1 : 0, jobId);
    job.enabled = updates.enabled ? 1 : 0;
  }

  if (updates.config !== undefined) {
    db.prepare("UPDATE jobs SET config = ? WHERE id = ?").run(JSON.stringify(updates.config), jobId);
  }

  // Reschedule cron
  scheduleCron(job);
}

export function initJobs(): void {
  seedDefaultJobs();
  markStaleRunsAsFailed();
  startCronSchedules();
}
