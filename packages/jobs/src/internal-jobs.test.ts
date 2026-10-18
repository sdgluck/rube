/**
 * Internal jobs used to be second-class: no context, no progress, and
 * cancellation that "worked" only until the handler returned and overwrote the
 * row with `completed`. These pin the parity.
 */
import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken } from "@tinkerbell/db";
import { jobRuns, jobs } from "@tinkerbell/db";
import { createRunner } from "./runner.ts";
import { createInternalJobs, QUIET_INTERNAL_JOBS } from "./internal-jobs.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { startJob, cancelRun, sweepStuckRuns } = createRunner(services);
const { internalJobs } = createInternalJobs(services);

const { and, eq } = await import("drizzle-orm");

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

  it("gets a checkpoint that deliberately stores nothing", async () => {
    // Internal jobs are sub-second, so there is nothing to resume — and unlike
    // the command path nothing here clears a checkpoint on cancel, so a real
    // one would outlive the run that wrote it.
    let readBack: unknown = "unset";
    descriptor.run = (ctx: import("@tinkerbell/core").JobContext) => {
      ctx.checkpoint.write({ some: "state" });
      readBack = ctx.checkpoint.read();
      return "done";
    };

    await startJob(JOB_ID);

    assert.equal(readBack, null, "internal-job checkpoints must not persist anything");
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

  it("aborts a wedged run when the watchdog force-fails it", async () => {
    // The controller is right here in this process, unlike a command job's
    // worker thread. Not aborting it would free the "already running" guard
    // while the handler kept going, so the next cron tick would stack a second
    // concurrent execution on top of one that never stops.
    let released!: () => void;
    const blocked = new Promise<void>((resolve) => (released = resolve));
    let abortedByWatchdog = false;

    descriptor.run = async (ctx: import("@tinkerbell/core").JobContext) => {
      ctx.signal.addEventListener("abort", () => {
        abortedByWatchdog = true;
        released();
      });
      await blocked;
      return "unblocked";
    };

    const pending = startJob(JOB_ID);
    // Let startJob reach its first await, so the run row and the controller
    // both exist before the sweep runs.
    await Promise.resolve();

    const runId = activeRunId();
    assert.ok(runId, "expected a running row");

    // Push the row past its budget and sweep.
    const budget = (internalJobs[JOB_ID] as { timeoutMs: number }).timeoutMs;
    db.update(jobRuns)
      .set({ startedAt: Date.now() - budget - 60_000 * 5 })
      .where(eq(jobRuns.id, runId))
      .run();
    assert.equal(sweepStuckRuns(), 1);

    assert.equal(abortedByWatchdog, true, "the watchdog should have aborted the handler");
    await pending;

    // The watchdog's verdict stands — the handler must not resurrect it.
    assert.equal(runRow(runId)?.status, "failed");
  });

  it("marks healthcheck quiet so it doesn't emit 1440 events a day", () => {
    assert.equal(internalJobs.healthcheck.quiet, true);
    // Everything else is loud by default — quiet is opt-in, per job.
    assert.equal((internalJobs["purge-runs"] as { quiet?: boolean }).quiet, undefined);
  });

  it("lists every quiet job in QUIET_INTERNAL_JOBS, and nothing else", () => {
    // The run list hides a quiet job's repeated runs by this list. A job marked
    // quiet but missing here would flood it again; one listed but not quiet
    // would hide runs that do emit events.
    const quiet = Object.entries(internalJobs)
      .filter(([, d]) => (d as { quiet?: boolean }).quiet)
      .map(([name]) => name);
    assert.deepEqual([...QUIET_INTERNAL_JOBS].sort(), quiet.sort());
  });
});
