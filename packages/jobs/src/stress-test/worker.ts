/**
 * The stress harness's child process.
 *
 * **This file is a process entrypoint.** `startStressTest` forks it, and
 * nothing else imports it, so the module body at the bottom — building a
 * container and calling `createWorker` — is the only thing that makes any of it
 * run. That line is load-bearing in a way the type checker cannot see.
 *
 * It is worth saying why. When the job system moved to DI, this file's
 * top-level `process.on("message")` was wrapped in an exported
 * `createWorker(deps)` and the call was never added. Nothing failed to compile;
 * nothing was unresolvable; the exported factory was simply never invoked. The
 * forked child registered no `message` listener, so Node unreffed the IPC
 * channel and it exited within ~85ms, and the parent filed that as
 * "Worker process exited unexpectedly". Every stress test failed instantly for
 * three months. If you refactor this file, the last two lines are the feature.
 *
 * The container is built here rather than inherited because a forked child has
 * its own module graph: none of `apps/server`'s boot runs in this process. It
 * is the same `buildContainer()` the server and the Sidequest worker call.
 */

import { buildContainer, ServicesToken, type Services } from "@tinkerbell/composition";
import { createStressTest } from "./index.ts";
import { eq } from "drizzle-orm";
import { deriveJobContext, errorMessage } from "@tinkerbell/core";
import { stressTestRuns } from "@tinkerbell/db";
import { createPlexClient } from "@tinkerbell/plex";

import { registerJobs } from "../index.ts";
import { type StressTestConfig } from "./index.ts";
import { decimate, type StressTestSample } from "./telemetry.ts";
import { type JobContext } from "@tinkerbell/core";
import {
  JOB_CANCEL_POLL_INTERVAL_MS,
  JOB_LOG_FLUSH_INTERVAL_MS,
  JOB_LOG_MAX_BYTES,
  JOB_LOG_TAIL_BYTES,
  STRESS_TELEMETRY_MAX_SAMPLES,
} from "../limits.ts";

interface WorkerMessage {
  id: string;
  config: StressTestConfig;
}

export function createWorker(deps: Services, onDone: () => void = () => process.exit(0)) {
  const { clients, config, db } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { runStressTest } = createStressTest(deps);

  process.on("message", (msg: WorkerMessage) => {
    void run(msg.id, msg.config);
  });

  async function run(id: string, config: StressTestConfig): Promise<void> {
    const controller = new AbortController();

    let logBuffer = "";
    let storedLog = "";
    let currentProgress = 0;
    let currentMessage = "";
    let lastWritten = "";
    /**
     * The run's telemetry, accumulated here and written on the same tick as the
     * log. It rides the existing flush rather than getting a timer of its own
     * because both are the same problem — a child process with no way to talk to
     * the API except this row — and two writers to one row twice a second is one
     * write more than it needs.
     */
    let samples: StressTestSample[] = [];
    let samplesWritten = 0;

    /**
     * The stored log is kept in memory and rewritten, rather than read back
     * each tick, and it is capped the way job logs are
     * (`JOB_LOG_MAX_BYTES`/`JOB_LOG_TAIL_BYTES`). Previously this did a
     * read-modify-write of the whole column twice a second with no upper bound,
     * so a long verbose run rewrote a growing string forever.
     */
    function flushToDb(): void {
      const telemetryPending = samples.length !== samplesWritten;
      if (!logBuffer && !telemetryPending && `${currentProgress}${currentMessage}` === lastWritten) return;
      if (logBuffer) {
        storedLog += logBuffer;
        logBuffer = "";
        if (storedLog.length > JOB_LOG_MAX_BYTES) {
          storedLog = `…log truncated…\n${storedLog.slice(-JOB_LOG_TAIL_BYTES)}`;
        }
      }
      if (telemetryPending) samples = decimate(samples, STRESS_TELEMETRY_MAX_SAMPLES);
      try {
        db.update(stressTestRuns)
          .set({ log: storedLog, progress: currentProgress, message: currentMessage, telemetry: samples })
          .where(eq(stressTestRuns.id, id))
          .run();
        lastWritten = `${currentProgress}${currentMessage}`;
        samplesWritten = samples.length;
      } catch {
        // DB may be closed during shutdown.
      }
    }

    const flushTimer = setInterval(flushToDb, JOB_LOG_FLUSH_INTERVAL_MS);

    // Cancellation arrives as a status change on the row, not as a signal: the
    // API process cannot abort a controller inside this one.
    const cancelTimer = setInterval(() => {
      try {
        const row = db
          .select({ status: stressTestRuns.status })
          .from(stressTestRuns)
          .where(eq(stressTestRuns.id, id))
          .get();
        if (row?.status === "cancelled") controller.abort();
      } catch {
        // DB may be closed.
      }
    }, JOB_CANCEL_POLL_INTERVAL_MS);

    const ctx: JobContext = deriveJobContext(deps.scope, {
      log: (...args: unknown[]) => {
        const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
        logBuffer += text;
        const trimmed = text.trim();
        if (trimmed) currentMessage = trimmed;
      },
      progress: (current: number, total: number, msg: string) => {
        currentProgress = total > 0 ? Math.min(current / total, 1) : 0;
        currentMessage = msg;
      },
      signal: controller.signal,
    });

    /** The row's status wins if the run was cancelled — the API set it, and the
     *  cleanup path must not overwrite it with an outcome of its own. */
    function finish(set: { status: string; message?: string; progress?: number }): void {
      const finalRow = db
        .select({ status: stressTestRuns.status })
        .from(stressTestRuns)
        .where(eq(stressTestRuns.id, id))
        .get();
      if (finalRow?.status === "cancelled") return;
      db.update(stressTestRuns)
        .set({ ...set, finishedAt: Date.now() })
        .where(eq(stressTestRuns.id, id))
        .run();
    }

    try {
      const plexUrl = getConfig("global_plex_url");
      const plexToken = getConfig("global_plex_token");
      if (!plexUrl || !plexToken) {
        throw new Error("Plex URL and token are not configured");
      }

      const client = createPlexClient({
        url: plexUrl,
        token: plexToken,
        signal: controller.signal,
        onHealth: plexHealthCallback,
      });

      await runStressTest(client, config, ctx, {
        resultId: id,
        onSample: (sample) => samples.push(sample),
      });

      clearInterval(flushTimer);
      clearInterval(cancelTimer);
      flushToDb();
      finish({ status: "completed", progress: 1 });
    } catch (err) {
      clearInterval(flushTimer);
      clearInterval(cancelTimer);

      logBuffer += `\nError: ${errorMessage(err)}\n`;
      flushToDb();
      try {
        finish({ status: "failed", message: errorMessage(err) });
      } catch {
        // DB may be closed during shutdown.
      }
    } finally {
      clearInterval(flushTimer);
      clearInterval(cancelTimer);
      onDone();
    }
  }

  return { run };
}

// ─── Entrypoint. See the header comment: without these two lines the forked
// child does nothing at all, and does it silently. ───────────────────────────
const container = buildContainer({}, [registerJobs]);
createWorker(container.resolve(ServicesToken), () => {
  void container.dispose().finally(() => process.exit(0));
});
