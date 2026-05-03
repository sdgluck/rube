import { eq } from "drizzle-orm";
import { db } from "./db/index.ts";
import { stressTestRuns } from "./db/schema.ts";
import { createPlexClient } from "./plex.ts";
import { getConfig } from "./config.ts";
import { runStressTest, type StressTestConfig } from "./stress-test.ts";
import type { JobContext } from "./shared/job-context.ts";

interface WorkerMessage {
  id: string;
  config: StressTestConfig;
}

process.on("message", (msg: WorkerMessage) => {
  void run(msg.id, msg.config);
});

async function run(id: string, config: StressTestConfig): Promise<void> {
  const controller = new AbortController();

  let logBuffer = "";
  let currentProgress = 0;
  let currentMessage = "";

  function flushToDb(): void {
    if (!logBuffer && currentProgress === 0) return;
    try {
      const currentRow = db
        .select({ log: stressTestRuns.log })
        .from(stressTestRuns)
        .where(eq(stressTestRuns.id, id))
        .get();
      const existingLog = currentRow?.log ?? "";
      db.update(stressTestRuns)
        .set({
          log: existingLog + logBuffer,
          progress: currentProgress,
          message: currentMessage,
        })
        .where(eq(stressTestRuns.id, id))
        .run();
      logBuffer = "";
    } catch {
      // DB may be closed during shutdown
    }
  }

  const flushTimer = setInterval(flushToDb, 500);

  // Poll for cancellation by checking DB status
  const cancelTimer = setInterval(() => {
    try {
      const row = db
        .select({ status: stressTestRuns.status })
        .from(stressTestRuns)
        .where(eq(stressTestRuns.id, id))
        .get();
      if (row?.status === "cancelled") {
        controller.abort();
      }
    } catch {
      // DB may be closed
    }
  }, 1000);

  const ctx: JobContext = {
    log: (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
      logBuffer += text;
      const trimmed = text.trim();
      if (trimmed) currentMessage = trimmed;
    },
    progress: (current: number, total: number, msg: string) => {
      currentProgress = total > 0 ? (current - 1) / total : 0;
      currentMessage = msg;
    },
    signal: controller.signal,
  };

  try {
    const plexUrl = getConfig("global_plex_url");
    const plexToken = getConfig("global_plex_token");
    if (!plexUrl || !plexToken) {
      throw new Error("Plex URL and token are not configured");
    }

    const client = createPlexClient({ url: plexUrl, token: plexToken, signal: controller.signal });

    await runStressTest(client, config, ctx, id);

    clearInterval(flushTimer);
    clearInterval(cancelTimer);
    flushToDb();

    // Check if cancelled during execution
    const finalRow = db
      .select({ status: stressTestRuns.status })
      .from(stressTestRuns)
      .where(eq(stressTestRuns.id, id))
      .get();
    if (finalRow?.status !== "cancelled") {
      db.update(stressTestRuns)
        .set({ status: "completed", progress: 1, finishedAt: Date.now() })
        .where(eq(stressTestRuns.id, id))
        .run();
    }
  } catch (err) {
    clearInterval(flushTimer);
    clearInterval(cancelTimer);

    logBuffer += `\nError: ${(err as Error).message}\n`;
    flushToDb();

    // Check if cancelled
    const finalRow = db
      .select({ status: stressTestRuns.status })
      .from(stressTestRuns)
      .where(eq(stressTestRuns.id, id))
      .get();
    if (finalRow?.status !== "cancelled") {
      db.update(stressTestRuns)
        .set({ status: "failed", message: (err as Error).message, finishedAt: Date.now() })
        .where(eq(stressTestRuns.id, id))
        .run();
    }
  } finally {
    clearInterval(flushTimer);
    clearInterval(cancelTimer);
    process.exit(0);
  }
}
