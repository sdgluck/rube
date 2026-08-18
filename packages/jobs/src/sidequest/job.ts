import { Job } from "sidequest";
import { eq, sql } from "drizzle-orm";
import { jobRuns } from "@tinkerbell/db";
import type { Scope } from "@tinkerbell/container";
import { buildContainer, ServicesToken, type Services } from "@tinkerbell/composition";
import { registerJobs } from "../index.ts";
import {
  commonJobConfigSchema,
  createLogger,
  errorMessage,
  formatDuration,
  type JobContext,
  type CommonJobConfig,
} from "@tinkerbell/core";
import { COMMANDS, isCommandName, type CommandName } from "../commands/catalog.ts";
import { createCheckpoint as createCheckpointFactory } from "../checkpoint.ts";
import { isShuttingDown } from "../runner.ts";
import { isTerminalStatus } from "../statuses.ts";
import {
  JOB_CANCEL_POLL_INTERVAL_MS,
  JOB_LOG_FLUSH_INTERVAL_MS,
  JOB_LOG_MAX_BYTES,
  JOB_LOG_TAIL_BYTES,
  JOB_TIMEOUT_GRACE_MS,
} from "../limits.ts";
const baseLog = createLogger("jobs");

/**
 * This module is loaded in a Sidequest **worker thread**, which has its own
 * module graph: none of `apps/server`'s boot runs here. So the worker builds
 * its own container — the same `buildContainer()` the server calls, producing
 * the same graph.
 *
 * This one line replaces `registerCoreHooks()`, and the difference is not
 * cosmetic. That function assigned four mutable slots in `@tinkerbell/core`
 * that each defaulted to a no-op, and for a long time nothing called it here:
 * every job in every worker ran with health reporting, notification traces,
 * provider rescans and collection counts silently switched off. Nothing threw,
 * nothing logged. A container that is missing an edge cannot resolve, and the
 * resolve-all test in `@tinkerbell/composition` fails before it ships.
 */

export function createCommandJob(services: Services, scopeFor: (name: string) => Scope) {
  const { db } = services;
  const { emitEvent } = services.events;
  const { createCheckpoint } = createCheckpointFactory(services);

  return class CommandJob extends Job {
    async run(commandName: string, runId: string, configJson: string, jobName: string, jobId: string) {
      const log = baseLog.child({ command: commandName, runId, job: jobName });

      if (!isCommandName(commandName)) {
        throw new Error(`Unknown command: ${commandName}`);
      }

      /**
       * The `job_runs` row is the authority on whether this execution may run.
       *
       * If it isn't `running` by the time we get here, this is an orphan: a job
       * that survived a restart inside Sidequest's own queue, or a stale-job
       * retry. Executing it would re-apply Plex-side effects and corrupt a
       * finished run's log, so we drop it.
       *
       * We deliberately do NOT drain Sidequest's backlog before starting the
       * engine — its backend API has no supported "delete everything pending"
       * call, and this guard covers the same ground with far less coupling to
       * the engine's internals.
       */
      const claim = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
      if (!claim) {
        log.warn("orphaned execution: run row is gone");
        return this.complete({ skipped: "missing-run" });
      }
      if (claim.status !== "running") {
        log.warn("orphaned execution: run already finished", { status: claim.status });
        return this.complete({ skipped: claim.status });
      }

      const startedAt = Date.now();
      const controller = new AbortController();

      /** Log DB-write failures unless the engine is mid-shutdown, where they're expected. */
      const logDbError = (op: string, err: unknown): void => {
        if (isShuttingDown()) return;
        log.error(`failed to ${op}`, { err: errorMessage(err) });
      };

      // ── Log buffering ─────────────────────────────────────────────────────
      // Appends go out via SQL `log = log || ?` (Phase 2.1) rather than a
      // read-modify-write of the whole column, which was quadratic in log size
      // and a WAL-contention source against the API's own writes.
      let logBuffer = "";
      let writtenBytes = 0;
      let capped = false;
      let tailBuffer = "";
      let suppressedLines = 0;
      let progress = 0;
      let message = "";
      let lastFlushedProgress = -1;
      let lastFlushedMessage: string | null = null;

      function flushLog(): void {
        // The old guard skipped `message`-only updates whenever progress
        // happened to be 0, which is most of a job's early life.
        if (logBuffer.length === 0 && progress === lastFlushedProgress && message === lastFlushedMessage) return;
        const chunk = logBuffer;
        logBuffer = "";
        try {
          db.update(jobRuns)
            .set(chunk.length > 0 ? { log: sql`${jobRuns.log} || ${chunk}`, progress, message } : { progress, message })
            .where(eq(jobRuns.id, runId))
            .run();
          writtenBytes += Buffer.byteLength(chunk);
          lastFlushedProgress = progress;
          lastFlushedMessage = message;
        } catch (err) {
          // Put the chunk back so a transient lock doesn't silently lose log lines.
          logBuffer = chunk + logBuffer;
          logDbError("flush log/progress", err);
        }
      }

      /** Final chunk: the truncation marker plus whatever tail we kept. */
      function finalizeLog(): void {
        if (capped) {
          logBuffer +=
            `\n… log truncated at ${Math.round(JOB_LOG_MAX_BYTES / (1024 * 1024))} MB; ` +
            `${suppressedLines} further line(s) suppressed. Tail follows.\n` +
            tailBuffer;
          // Let the final write through regardless of the cap.
          capped = false;
          tailBuffer = "";
        }
        flushLog();
      }

      const ctx: JobContext = {
        log: (...args: unknown[]) => {
          const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
          const trimmed = text.trim();
          if (trimmed) message = trimmed;

          if (capped) {
            // Past the cap we keep a bounded tail only — on a failing run the
            // last few hundred lines are the part anyone actually reads.
            suppressedLines++;
            tailBuffer += text;
            if (tailBuffer.length > JOB_LOG_TAIL_BYTES) {
              tailBuffer = tailBuffer.slice(tailBuffer.length - JOB_LOG_TAIL_BYTES);
            }
            return;
          }

          logBuffer += text;
          if (writtenBytes + Buffer.byteLength(logBuffer) >= JOB_LOG_MAX_BYTES) {
            capped = true;
            log.warn("log cap reached; retaining tail only", { maxBytes: JOB_LOG_MAX_BYTES });
          }
        },
        progress: (current: number, total: number, msg: string) => {
          progress = total > 0 ? Math.min(current / total, 1) : 0;
          message = msg;
        },
        signal: controller.signal,
        checkpoint: createCheckpoint(jobId),
        runId,
        // The run's own scope: everything a command resolves belongs to this
        // execution and is released with it.
        scope: scopeFor(`job:${commandName}`),
      };

      // ── Config ────────────────────────────────────────────────────────────
      // Fail closed. The old code warned and fell back to `{}`, so an `overlays`
      // job configured with `mode: "remove"` would silently *apply* overlays
      // instead — a data-affecting silent fallback. A failed run with the Zod
      // message in its log is visible and actionable.
      let jobConfig: CommonJobConfig;
      try {
        const raw = JSON.parse(configJson);
        jobConfig = commonJobConfigSchema.passthrough().parse(raw);
      } catch (err) {
        const msg = `Invalid job config: ${errorMessage(err)}`;
        log.error("invalid job config", { err: errorMessage(err) });
        try {
          db.update(jobRuns)
            .set({ status: "failed", log: msg + "\n", message: msg, finishedAt: Date.now() })
            .where(eq(jobRuns.id, runId))
            .run();
          emitEvent("job.failed", `${jobName} failed: ${msg}`, { jobId, runId });
        } catch (err2) {
          logDbError("mark run as failed", err2);
        }
        return this.complete({ error: msg });
      }

      const flushTimer = setInterval(flushLog, JOB_LOG_FLUSH_INTERVAL_MS);

      // Poll `job_runs.status` for a cancellation request from the API. See
      // `cancelRun` — the API writes `cancelling` and we own the terminal write.
      let cancelRequested = false;
      const cancelTimer = setInterval(() => {
        try {
          const row = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
          if (row?.status === "cancelling" || row?.status === "cancelled") {
            cancelRequested = true;
            controller.abort();
          }
        } catch (err) {
          logDbError("poll cancellation", err);
        }
      }, JOB_CANCEL_POLL_INTERVAL_MS);

      // ── Deadline ──────────────────────────────────────────────────────────
      // Two layers. The budget aborts `ctx.signal`, which every command threads
      // into its awaits; the grace timer throws so the run is marked `failed`
      // even if a command ignores its signal.
      //
      // Be honest about the limit: aborting a signal cannot kill a worker thread
      // wedged in a syscall. Per-request deadlines (Phase 0.2) are the real fix;
      // this is the backstop, and the main-process watchdog recovers the UI when
      // even this doesn't fire.
      const budgetMs = COMMANDS[commandName as CommandName].timeoutMs;
      let timedOut = false;
      const budgetTimer = setTimeout(() => {
        timedOut = true;
        ctx.log(`Timed out after ${formatDuration(budgetMs)} — aborting.`);
        log.error("command exceeded its budget; aborting", { budgetMs });
        controller.abort();
      }, budgetMs);
      let graceTimer: NodeJS.Timeout | undefined;
      const graceDeadline = new Promise<never>((_, reject) => {
        graceTimer = setTimeout(
          () => reject(new Error(`Command did not unwind ${formatDuration(JOB_TIMEOUT_GRACE_MS)} after its timeout`)),
          budgetMs + JOB_TIMEOUT_GRACE_MS,
        );
      });

      /** Was this run cancelled, per the row rather than per our local flag? */
      const wasCancelled = (): boolean => {
        if (cancelRequested) return true;
        try {
          const row = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
          return row?.status === "cancelling" || row?.status === "cancelled";
        } catch {
          return false;
        }
      };

      /**
       * Has something else already ended this run?
       *
       * The watchdog force-fails a run whose worker looks wedged. If that worker
       * later finishes anyway, it must not flip the row back to `completed` — a
       * run the user was told had failed would silently become a success, and
       * the `job.failed` event would be left contradicting the row.
       */
      const alreadyTerminal = (): boolean => {
        try {
          const row = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
          return !!row && isTerminalStatus(row.status);
        } catch {
          return false;
        }
      };

      /** Write the terminal `cancelled` status. The worker owns this, not the API. */
      const finishCancelled = (): void => {
        finalizeLog();
        // Cancelling discards the checkpoint, unlike a crash or a restart. Those
        // are accidents where resuming is the kindest thing to do; a cancel is a
        // deliberate act, and "cancel, then Run now" reads as "start over". The
        // failure modes aren't symmetric either: redoing work the user wanted
        // redone is cheap, silently skipping it is not.
        ctx.checkpoint.clear();
        try {
          if (alreadyTerminal()) return;
          db.update(jobRuns).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(jobRuns.id, runId)).run();
        } catch (err) {
          logDbError("mark run as cancelled", err);
        }
        log.info("cancelled", { durationMs: Date.now() - startedAt });
      };

      try {
        const mod = await COMMANDS[commandName as CommandName].load();
        const commandFn = mod.default;
        // The name is validated against COMMANDS above, so this only fires if a
        // command file exists but forgot its default export — an internal bug
        // typechecking would catch, but the runtime guard is cheap.
        if (typeof commandFn !== "function") {
          throw new Error(`Command module ${commandName} has no default export`);
        }

        // Attach a handler to the command's own promise *before* racing. If the
        // grace deadline wins, the command promise is still pending — and it will
        // very likely reject shortly afterwards, because the budget timer aborted
        // `ctx.signal` a minute earlier and most commands surface that as a
        // thrown AbortError. With no handler that becomes an unhandled rejection
        // inside a Sidequest worker thread, where the process-level handler in
        // `server.ts` doesn't apply. The race result is what we act on; this
        // catch exists only to keep the loser quiet.
        const running = commandFn(ctx, jobConfig as never);
        running.catch(() => {});
        await Promise.race([running, graceDeadline]);

        if (wasCancelled()) {
          finishCancelled();
          return this.complete({ cancelled: true });
        }
        if (timedOut) {
          throw new Error(`Command exceeded its ${formatDuration(budgetMs)} budget`);
        }

        progress = 1;
        finalizeLog();
        if (alreadyTerminal()) {
          log.warn("finished after the run was already ended elsewhere; leaving its status alone");
          return this.complete({ ok: true, superseded: true });
        }
        db.update(jobRuns)
          .set({ status: "completed", progress: 1, finishedAt: Date.now() })
          .where(eq(jobRuns.id, runId))
          .run();
        emitEvent("job.completed", `${jobName} completed in ${formatDuration(Date.now() - startedAt)}`, {
          jobId,
          runId,
        });
        log.info("completed", { durationMs: Date.now() - startedAt });

        return this.complete({ ok: true });
      } catch (err) {
        // An abort raised by cancellation surfaces here as a thrown AbortError;
        // the row, not the exception type, decides how we record it.
        if (wasCancelled()) {
          finishCancelled();
          return this.complete({ cancelled: true });
        }

        const errorMsg = timedOut ? `Command exceeded its ${formatDuration(budgetMs)} budget` : errorMessage(err);
        ctx.log(`\nError: ${errorMsg}`);
        finalizeLog();

        try {
          // Don't double-report a run the watchdog already failed.
          if (!alreadyTerminal()) {
            db.update(jobRuns).set({ status: "failed", finishedAt: Date.now() }).where(eq(jobRuns.id, runId)).run();
            emitEvent("job.failed", `${jobName} failed: ${errorMsg}`, { jobId, runId });
          }
        } catch (err2) {
          logDbError("mark run as failed", err2);
        }
        log.error("failed", { err: errorMsg, durationMs: Date.now() - startedAt });

        // Always `complete()` in Sidequest — `job_runs` is our source of truth
        // for failure, and letting Sidequest retry would re-apply side effects.
        return this.complete({ error: errorMsg });
      } finally {
        clearInterval(flushTimer);
        clearInterval(cancelTimer);
        clearTimeout(budgetTimer);
        if (graceTimer) clearTimeout(graceTimer);
      }
    }
  };
}

/**
 * The worker's own container.
 *
 * A Sidequest worker thread runs none of `apps/server`, so it builds the graph
 * itself — the same `buildContainer()` the server calls, producing the same
 * wiring. This one line replaces `registerCoreHooks()`, and the difference is
 * not cosmetic: that function assigned four mutable slots in
 * `@tinkerbell/core` that each defaulted to a no-op, and for a long time
 * nothing called it here. Every job in every worker ran with health reporting,
 * notification traces, provider rescans and collection counts silently
 * switched off, with nothing thrown and nothing logged.
 */
const container = buildContainer({}, [registerJobs]);

export const CommandJob = createCommandJob(container.resolve(ServicesToken), (name) => container.createScope(name));
