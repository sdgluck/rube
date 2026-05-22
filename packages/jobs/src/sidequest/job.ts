import { Job } from "sidequest";
import { errorMessage } from "@tinkerbell/core";
import { eq } from "drizzle-orm";
import { db, jobRuns } from "@tinkerbell/db";
import { emitEvent } from "@tinkerbell/domain.events";
import {
  commonJobConfigSchema,
  type JobContext,
  type CommonJobConfig,
  type GenerateJobConfig,
  type BywJobConfig,
  type OverlaysJobConfig,
} from "@tinkerbell/core";
import { JOB_CANCEL_POLL_INTERVAL_MS, JOB_LOG_FLUSH_INTERVAL_MS } from "../limits.ts";
import { isShuttingDown } from "../runner.ts";

/**
 * Log job DB-write failures unless the engine is mid-shutdown. The previous
 * blanket `catch {}` blocks here hid every failure — constraint violations,
 * lock timeouts, schema drift — and left runs stuck in `running` forever.
 */
function logJobDbError(jobName: string, runId: string, op: string, err: unknown): void {
  if (isShuttingDown()) return;
  console.error(`[jobs] ${jobName} (${runId}) failed to ${op}:`, errorMessage(err));
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const VALID_COMMANDS = new Set([
  "shuffle",
  "generate",
  "because-you-watched",
  "sync-collections",
  "label",
  "label-undo",
  "byw-remove",
  "sync-media",
  "overlays",
  "sync-users",
  "posters-refresh",
  "migrate-collections",
]);

export class CommandJob extends Job {
  async run(commandName: string, runId: string, configJson: string, jobName: string, jobId: string) {
    if (!VALID_COMMANDS.has(commandName)) {
      throw new Error(`Unknown command: ${commandName}`);
    }
    const startedAt = Date.now();
    const controller = new AbortController();

    let logBuffer = "";
    let progress = 0;
    let message = "";

    function flushLog(): void {
      if (logBuffer.length === 0 && progress === 0) return;
      try {
        const currentRow = db.select({ log: jobRuns.log }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
        const currentLog = currentRow?.log ?? "";
        db.update(jobRuns)
          .set({ log: currentLog + logBuffer, progress, message })
          .where(eq(jobRuns.id, runId))
          .run();
        logBuffer = "";
      } catch (err) {
        logJobDbError(jobName, runId, "flush log/progress", err);
      }
    }

    const ctx: JobContext = {
      log: (...args: unknown[]) => {
        const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
        logBuffer += text;
        const trimmed = text.trim();
        if (trimmed) message = trimmed;
      },
      progress: (current: number, total: number, msg: string) => {
        progress = total > 0 ? Math.min(current / total, 1) : 0;
        message = msg;
      },
      signal: controller.signal,
    };

    let jobConfig: CommonJobConfig = {};
    try {
      const raw = JSON.parse(configJson);
      const parsed = commonJobConfigSchema.passthrough().safeParse(raw);
      if (parsed.success) {
        jobConfig = parsed.data;
      } else {
        console.warn(`[jobs] Invalid config for ${jobName}:`, parsed.error.message);
      }
    } catch (err) {
      console.warn(`[jobs] Failed to parse config for ${jobName}:`, errorMessage(err));
    }

    // Periodic flush of log/progress to the DB
    const flushTimer = setInterval(flushLog, JOB_LOG_FLUSH_INTERVAL_MS);

    // Poll for cancellation by checking jobRuns.status
    const cancelTimer = setInterval(() => {
      try {
        const row = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
        if (row?.status === "cancelled") {
          controller.abort();
        }
      } catch (err) {
        logJobDbError(jobName, runId, "poll cancellation", err);
      }
    }, JOB_CANCEL_POLL_INTERVAL_MS);

    try {
      const mod = await import(`../commands/${commandName}.ts`);
      const commandFn: (
        ctx: JobContext,
        config: CommonJobConfig | GenerateJobConfig | BywJobConfig | OverlaysJobConfig,
      ) => Promise<void> = mod.default;
      // `commandName` is already validated against VALID_COMMANDS above, so
      // an unknown name throws at the import. This branch only fires if a
      // command file exists but forgot to default-export — an internal bug
      // typechecking would catch, but the runtime guard is cheap.
      if (typeof commandFn !== "function") {
        throw new Error(`Command module ${commandName} has no default export`);
      }

      await commandFn(ctx, jobConfig);

      flushLog();

      // Check if cancelled during execution
      const finalRow = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
      if (finalRow?.status === "cancelled") {
        console.log(`[jobs] ${jobName} was cancelled`);
        return this.complete({ cancelled: true });
      }

      db.update(jobRuns)
        .set({ status: "completed", progress: 1, finishedAt: Date.now() })
        .where(eq(jobRuns.id, runId))
        .run();
      emitEvent("job.completed", `${jobName} completed in ${formatDuration(Date.now() - startedAt)}`, { jobId });
      console.log(`[jobs] ${jobName} completed`);

      return this.complete({ ok: true });
    } catch (err) {
      // Check if cancelled
      const finalRow = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
      if (finalRow?.status === "cancelled") {
        console.log(`[jobs] ${jobName} was cancelled`);
        return this.complete({ cancelled: true });
      }

      const errorMsg = errorMessage(err);
      logBuffer += `\nError: ${errorMsg}\n`;
      flushLog();

      try {
        db.update(jobRuns).set({ status: "failed", finishedAt: Date.now() }).where(eq(jobRuns.id, runId)).run();
        emitEvent("job.failed", `${jobName} failed: ${errorMsg}`, { jobId });
      } catch (err2) {
        logJobDbError(jobName, runId, "mark run as failed", err2);
      }
      console.error(`[jobs] ${jobName} failed: ${errorMsg}`);

      // Mark as complete in Sidequest (we handle failure status in our own DB)
      return this.complete({ error: errorMsg });
    } finally {
      clearInterval(flushTimer);
      clearInterval(cancelTimer);
    }
  }
}
