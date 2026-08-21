/**
 * The regression guard for the bug this whole file exists because of.
 *
 * `worker.ts` is a process entrypoint. When the job system moved to DI, its
 * top-level `process.on("message")` was wrapped in an exported
 * `createWorker(deps)` and the call was never added. Nothing failed to compile
 * — an exported factory that nobody invokes is perfectly valid TypeScript — so
 * the forked child registered no message listener, Node unreffed the IPC
 * channel, and the child exited within ~85ms. Every stress test failed
 * instantly for three months behind "Worker process exited unexpectedly".
 *
 * No unit test could have caught that: the defect was the *absence* of a call
 * in a module nothing imports. Only forking the real file can. So this does.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createTestDb } from "@tinkerbell/db/test-db";
import { stressTestRuns } from "@tinkerbell/db";
import { eq } from "drizzle-orm";

const WORKER = join(import.meta.dirname, "worker.ts");

/**
 * The child reads its database from `DATA_DIR`, the same way every entrypoint
 * does, so pointing that at a throwaway directory is all the isolation needed.
 */
function forkWorker(dataDir: string) {
  return fork(WORKER, { env: { ...process.env, DATA_DIR: dataDir }, stdio: "ignore" });
}

describe("the stress-test worker entrypoint", () => {
  const testDb = createTestDb("tinkerbell-stress-worker-");
  after(() => testDb.dispose());

  it("stays alive after being forked", async () => {
    // The whole bug, in one assertion. A worker with no bootstrap exits almost
    // immediately because nothing refs the IPC channel.
    const child = forkWorker(testDb.dataDir);
    try {
      await delay(1500);
      assert.equal(child.exitCode, null, "the forked worker exited instead of waiting for work");
    } finally {
      child.kill();
    }
  });

  it("picks up a run sent over IPC and drives it to a terminal state", async () => {
    // Plex is deliberately not configured, so the run fails fast — but it can
    // only fail *from inside the worker*, which is the thing being proven. A
    // worker that never woke up would leave the row untouched at "running".
    const id = "worker-ipc-test";
    testDb.db
      .insert(stressTestRuns)
      .values({ id, config: { mode: "transcode", maxSessions: 1 }, steps: [], status: "running", startedAt: 1 })
      .run();

    const child = forkWorker(testDb.dataDir);
    try {
      child.send({ id, config: { mode: "transcode", maxSessions: 1 } });

      let row = testDb.db.select().from(stressTestRuns).where(eq(stressTestRuns.id, id)).get();
      for (let i = 0; i < 100 && row?.status === "running"; i++) {
        await delay(100);
        row = testDb.db.select().from(stressTestRuns).where(eq(stressTestRuns.id, id)).get();
      }

      assert.equal(row?.status, "failed", `run never left "running" — the worker did not process the message`);
      assert.match(row!.message, /Plex URL and token are not configured/);
    } finally {
      child.kill();
    }
  });
});
