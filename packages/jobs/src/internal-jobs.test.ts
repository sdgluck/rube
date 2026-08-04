/**
 * Internal jobs used to be second-class: no context, no progress, and
 * cancellation that "worked" only until the handler returned and overwrote the
 * row with `completed`. These pin the parity.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "./test-support/temp-db.ts";

setupTempDb();

const { and, eq } = await import("drizzle-orm");
const { db, jobs, jobRuns } = await import("@tinkerbell/db");
const { startJob, cancelRun } = await import("./runner.ts");
const { internalJobs } = await import("./internal-jobs.ts");

const JOB_ID = "purge-runs";
const descriptor = internalJobs[JOB_ID] as { run: unknown; quiet?: boolean };
const realRun = descriptor.run;

/** The id of this job's in-flight run, as the handler would have to find it. */
function activeRunId(): string | undefined {
  return db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobId, JOB_ID), eq(jobRuns.status, "running")))
    .get()?.id;
}

function runRow(id: string) {
  return db.select().from(jobRuns).where(eq(jobRuns.id, id)).get();
}

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  db.insert(jobs)
    .values({ id: JOB_ID, name: "Purge Old Runs", command: JOB_ID, schedule: "", enabled: 1, config: {} })
    .run();
});

afterEach(() => {
  descriptor.run = realRun;
});

describe("internal jobs", () => {
  it("gets a real JobContext", async () => {
    let seen: { hasLog: boolean; hasProgress: boolean; hasSignal: boolean; hasCheckpoint: boolean } | null = null;
    descriptor.run = (ctx: import("@tinkerbell/core").JobContext) => {
      seen = {
        hasLog: typeof ctx.log === "function",
        hasProgress: typeof ctx.progress === "function",
        hasSignal: ctx.signal instanceof AbortSignal,
        hasCheckpoint: typeof ctx.checkpoint?.read === "function",
      };
      ctx.log("a line from an internal job");
      ctx.progress(1, 2, "halfway");
      return "done";
    };

    const result = await startJob(JOB_ID);
    assert.ok(result.ok);
    assert.deepEqual(seen, { hasLog: true, hasProgress: true, hasSignal: true, hasCheckpoint: true });

    const row = runRow(result.runId);
    assert.equal(row?.status, "completed");
    assert.match(row?.log ?? "", /a line from an internal job/);
  });

  it("aborts the context signal when cancelled", async () => {
    let abortedDuringRun = false;
    descriptor.run = (ctx: import("@tinkerbell/core").JobContext) => {
      cancelRun(activeRunId()!);
      abortedDuringRun = ctx.signal.aborted;
      return "stopped early";
    };

    const result = await startJob(JOB_ID);
    assert.ok(result.ok);
    // `cancelRun` reaches into this process and aborts directly — internal
    // jobs don't have a worker thread polling for the status change.
    assert.equal(abortedDuringRun, true);
  });

  it("does not overwrite a cancellation with `completed`", async () => {
    descriptor.run = () => {
      cancelRun(activeRunId()!);
      return "finished anyway";
    };

    const result = await startJob(JOB_ID);
    assert.ok(result.ok);

    const row = runRow(result.runId);
    assert.equal(row?.status, "cancelled");
    assert.notEqual(row?.finishedAt, null);
  });

  it("records a cancellation even when the handler throws", async () => {
    descriptor.run = () => {
      cancelRun(activeRunId()!);
      throw new Error("aborted");
    };

    const result = await startJob(JOB_ID);
    assert.ok(result.ok);
    assert.equal(runRow(result.runId)?.status, "cancelled");
  });

  it("fails the run when the handler throws for a real reason", async () => {
    descriptor.run = () => {
      throw new Error("something broke");
    };

    const result = await startJob(JOB_ID);
    assert.ok(result.ok);
    const row = runRow(result.runId);
    assert.equal(row?.status, "failed");
    assert.match(row?.message ?? "", /something broke/);
  });

  it("marks healthcheck quiet so it doesn't emit 1440 events a day", () => {
    assert.equal(internalJobs.healthcheck.quiet, true);
    // Everything else is loud by default — quiet is opt-in, per job.
    assert.equal((internalJobs["purge-runs"] as { quiet?: boolean }).quiet, undefined);
  });
});
