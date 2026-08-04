/**
 * The concurrency-sensitive parts of the runner: the start guard, retention,
 * cancellation, the watchdog, and the engine config. These are precisely the
 * places where a bug stays invisible until production.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "./test-support/temp-db.ts";

setupTempDb();

const { db, jobs, jobRuns } = await import("@tinkerbell/db");
const { startJob, cancelRun, sweepStuckRuns, buildEngineConfig, DEFAULT_JOBS } = await import("./runner.ts");
const { JOB_RUN_KEEP_PER_JOB, JOB_CANCELLING_GRACE_MS } = await import("./limits.ts");
const { COMMANDS, isCommandName } = await import("./commands/catalog.ts");
const { isInternalJobName } = await import("./internal-jobs.ts");
const { FEATURE_TEMPLATES } = await import("./features.ts");

/**
 * A command job with no schedule. `preroll-process` is the safest choice:
 * `startJob` for a command enqueues onto Sidequest, which isn't running here,
 * so every test that needs a *live* run inserts the row directly instead.
 */
const JOB_ID = "test-job";

function seedJob(id = JOB_ID, command = "preroll-process"): void {
  db.insert(jobs)
    .values({ id, name: `Test ${id}`, command, schedule: "", enabled: 1, config: {} })
    .onConflictDoUpdate({ target: jobs.id, set: { command } })
    .run();
}

function insertRun(id: string, status: string, startedAt = Date.now()): void {
  db.insert(jobRuns).values({ id, jobId: JOB_ID, status, log: "", progress: 0, message: "", startedAt }).run();
}

function statusOf(runId: string): { status: string; finishedAt: number | null } | undefined {
  return db
    .select({ status: jobRuns.status, finishedAt: jobRuns.finishedAt })
    .from(jobRuns)
    .where(eq(jobRuns.id, runId))
    .get();
}

const { eq } = await import("drizzle-orm");

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  seedJob();
});

describe("startJob", () => {
  it("distinguishes a missing job from an occupied one", async () => {
    const missing = await startJob("does-not-exist");
    assert.deepEqual(missing, { ok: false, reason: "not-found" });
  });

  it("refuses a second run while one is running", async () => {
    insertRun("run-1", "running");
    const result = await startJob(JOB_ID);
    assert.deepEqual(result, { ok: false, reason: "already-running" });
    // And no stray row was created.
    assert.equal(db.select().from(jobRuns).all().length, 1);
  });

  it("treats `cancelling` as still occupying the job", async () => {
    // The command hasn't unwound yet. Letting a second run start here would
    // put two live executions on the same job — the exact thing the old
    // one-phase cancel allowed.
    insertRun("run-1", "cancelling");
    const result = await startJob(JOB_ID);
    assert.deepEqual(result, { ok: false, reason: "already-running" });
  });

  it("allows a new run once the previous one reached a terminal state", async () => {
    for (const terminal of ["completed", "failed", "cancelled"]) {
      db.delete(jobRuns).run();
      insertRun("prev", terminal);
      // `preroll-process` would enqueue onto an engine that isn't running, so
      // point the job at an unknown command: `startJob` still claims the row
      // (which is what we're asserting) and then fails the run in place.
      seedJob(JOB_ID, "no-such-command");
      const result = await startJob(JOB_ID);
      assert.equal(result.ok, true, `expected a start after a ${terminal} run`);
    }
  });

  it("fails the run rather than hanging when a job points at an unknown command", async () => {
    seedJob(JOB_ID, "removed-in-a-past-release");
    const result = await startJob(JOB_ID);
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    const row = statusOf(result.runId);
    assert.equal(row?.status, "failed");
    assert.notEqual(row?.finishedAt, null);
  });
});

describe("run retention", () => {
  it("keeps the newest JOB_RUN_KEEP_PER_JOB runs", async () => {
    const total = JOB_RUN_KEEP_PER_JOB + 10;
    const base = Date.now() - total * 1000;
    for (let i = 0; i < total; i++) {
      insertRun(`old-${i}`, "completed", base + i * 1000);
    }
    seedJob(JOB_ID, "no-such-command");

    await startJob(JOB_ID);

    const remaining = db
      .select({ id: jobRuns.id, startedAt: jobRuns.startedAt })
      .from(jobRuns)
      .all()
      .sort((a, b) => b.startedAt - a.startedAt);

    assert.equal(remaining.length, JOB_RUN_KEEP_PER_JOB);
    // The newest survivor among the pre-existing rows is the last one inserted.
    assert.ok(remaining.some((r) => r.id === `old-${total - 1}`));
    assert.ok(!remaining.some((r) => r.id === "old-0"));
  });
});

describe("cancelRun", () => {
  it("requests cancellation without ending the run", () => {
    insertRun("run-1", "running");
    assert.equal(cancelRun("run-1"), true);

    const row = statusOf("run-1");
    assert.equal(row?.status, "cancelling");
    // `finishedAt` stays null: the worker writes it when the command actually
    // unwinds, so the displayed duration is time spent, not time-to-cancel.
    assert.equal(row?.finishedAt, null);
  });

  it("refuses to cancel a run that is not running", () => {
    insertRun("done", "completed");
    insertRun("gone", "cancelling");
    assert.equal(cancelRun("done"), false);
    assert.equal(cancelRun("nope"), false);
    // Already cancelling — asking twice changes nothing.
    assert.equal(cancelRun("gone"), false);
  });
});

describe("watchdog", () => {
  it("leaves a run inside its budget alone", () => {
    insertRun("fresh", "running");
    assert.equal(sweepStuckRuns(), 0);
    assert.equal(statusOf("fresh")?.status, "running");
  });

  it("force-fails a run past its command budget", () => {
    const budget = COMMANDS["preroll-process"].timeoutMs;
    const now = Date.now();
    insertRun("wedged", "running", now - budget - 60_000 * 5);

    assert.equal(sweepStuckRuns(now), 1);
    const row = statusOf("wedged");
    assert.equal(row?.status, "failed");
    assert.notEqual(row?.finishedAt, null);

    const log = db.select({ log: jobRuns.log }).from(jobRuns).where(eq(jobRuns.id, "wedged")).get();
    assert.match(log?.log ?? "", /\[watchdog\]/);
  });

  it("force-fails a cancellation that never completes", () => {
    const now = Date.now();
    insertRun("stuck-cancel", "cancelling", now - JOB_CANCELLING_GRACE_MS - 1000);
    assert.equal(sweepStuckRuns(now), 1);
    assert.equal(statusOf("stuck-cancel")?.status, "failed");
  });
});

describe("engine config", () => {
  const config = buildEngineConfig("/tmp/sidequest.sqlite");

  it("disables Sidequest's stale-job sweep", () => {
    // The sweep has no heartbeat: it treats any job running >10min as dead and
    // re-queues it while the original is still executing. Re-enabling it would
    // re-apply Plex-side effects for label/overlays/personalize.
    assert.equal(config.releaseStaleJobsIntervalMin, false);
  });

  it("does not retry a whole command", () => {
    // Retries belong at the HTTP layer. Re-running a command that already
    // applied half its Plex-side effects is not a retry, it's a duplicate.
    assert.equal(config.jobDefaults.maxAttempts, 1);
  });

  it("gives each lane its own worker slot", () => {
    assert.deepEqual(
      config.queues.map((q) => q.name),
      ["default", "interactive"],
    );
    assert.equal(config.maxConcurrentJobs, config.queues.length);
  });
});

describe("job registry drift", () => {
  it("points every default job at a real command", () => {
    for (const job of DEFAULT_JOBS) {
      assert.ok(
        isCommandName(job.command) || isInternalJobName(job.command),
        `default job "${job.id}" points at unknown command "${job.command}"`,
      );
    }
  });

  it("points every feature template at a real command", () => {
    for (const template of FEATURE_TEMPLATES) {
      assert.ok(isCommandName(template.command), `feature "${template.id}" points at "${template.command}"`);
    }
  });
});
