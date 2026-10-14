/**
 * `CommandJob` behaviours that only show up under failure: the orphan guard,
 * fail-closed config parsing, the log pipeline, and who owns the terminal
 * write when a run is cancelled.
 *
 * The job is exercised by calling `run` against a minimal `this` rather than
 * booting the Sidequest engine — `complete()` is the only base-class method it
 * uses, and standing up a worker pool would test the engine, not us.
 */
import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { EventBusToken } from "@tinkerbell/ports";
import { DbToken } from "@tinkerbell/db";
import { events, jobRuns, jobs } from "@tinkerbell/db";
import { parseLogLine } from "@tinkerbell/contracts";
import { createRunner } from "../runner.ts";
import { createCheckpoint } from "../checkpoint.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { cancelRun } = createRunner(services);
const { createCheckpoint: makeCheckpoint } = createCheckpoint(services);

const { eq } = await import("drizzle-orm");
// The factory, not the module-level export: that one binds to the worker's
// own container, which by design opens the real database rather than this
// test's. What is worth testing is the behaviour, and that takes its services
// as an argument.
const { createCommandJob } = await import("./job.ts");
const CommandJob = createCommandJob(services, (name) => c.createScope(name));
const { COMMANDS } = await import("../commands/catalog.ts");
const { JOB_LOG_MAX_BYTES } = await import("../limits.ts");

const JOB_ID = "test-job";
const RUN_ID = "test-run";
/** Stubbed for every test; `shuffle` is arbitrary — nothing here is shuffle-specific. */
const COMMAND = "shuffle" as const;

type CommandFn = (ctx: import("@tinkerbell/core").JobContext, config: never) => Promise<void>;

const realLoad = COMMANDS[COMMAND].load;

/** Swap in a fake command implementation, returning a record of whether it ran. */
function stubCommand(fn: CommandFn): { called: boolean } {
  const state = { called: false };
  (COMMANDS[COMMAND] as { load: unknown }).load = async () => {
    state.called = true;
    return { default: fn };
  };
  return state;
}

/** Invoke `CommandJob.run` with only the base-class surface it actually uses. */
function runCommandJob(config = "{}"): Promise<unknown> {
  const self = { complete: (result: unknown) => result };
  return CommandJob.prototype.run.call(self as never, COMMAND, RUN_ID, config, "Test Job", JOB_ID);
}

function row() {
  return db.select().from(jobRuns).where(eq(jobRuns.id, RUN_ID)).get();
}

function insertRun(status: string): void {
  db.insert(jobRuns)
    .values({ id: RUN_ID, jobId: JOB_ID, status, log: "", progress: 0, message: "", startedAt: Date.now() })
    .run();
}

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  db.insert(jobs)
    .values({ id: JOB_ID, name: "Test Job", command: COMMAND, schedule: "", enabled: 1, config: {} })
    .run();
});

afterEach(() => {
  (COMMANDS[COMMAND] as { load: unknown }).load = realLoad;
});

/** A stored log with each line's time removed, for comparing text. */
const unstamped = (log: string | undefined) =>
  (log ?? "")
    .split("\n")
    .map((l) => parseLogLine(l).text)
    .join("\n");

describe("orphan guard", () => {
  it("does not import the command when the run row is already terminal", async () => {
    for (const terminal of ["failed", "completed", "cancelled"]) {
      db.delete(jobRuns).run();
      insertRun(terminal);
      const stub = stubCommand(async () => {});

      const result = await runCommandJob();

      assert.equal(stub.called, false, `command ran against a ${terminal} row`);
      assert.deepEqual(result, { skipped: terminal });
      // The finished run's row is untouched.
      assert.equal(row()?.status, terminal);
    }
  });

  it("does not import the command when the run row is gone", async () => {
    const stub = stubCommand(async () => {});
    const result = await runCommandJob();
    assert.equal(stub.called, false);
    assert.deepEqual(result, { skipped: "missing-run" });
  });

  it("runs normally when the row says `running`", async () => {
    insertRun("running");
    const stub = stubCommand(async (ctx) => ctx.log("working"));

    await runCommandJob();

    assert.equal(stub.called, true);
    assert.equal(row()?.status, "completed");
    assert.equal(row()?.progress, 1);
    assert.match(row()?.log ?? "", /working/);
  });
});

describe("config parsing", () => {
  it("fails the run on malformed JSON", async () => {
    insertRun("running");
    const stub = stubCommand(async () => {});

    await runCommandJob("{not json");

    assert.equal(stub.called, false);
    assert.equal(row()?.status, "failed");
    assert.match(row()?.log ?? "", /Invalid job config/);
  });

  it("fails the run on a schema-invalid config", async () => {
    insertRun("running");
    const stub = stubCommand(async () => {});

    // `sections` must be an array of strings. The old code warned and fell
    // back to `{}`, which for `overlays` silently flipped remove into apply.
    await runCommandJob(JSON.stringify({ sections: "Movies" }));

    assert.equal(stub.called, false);
    assert.equal(row()?.status, "failed");
    assert.match(row()?.log ?? "", /Invalid job config/);
  });

  it("passes a valid config through", async () => {
    insertRun("running");
    let received: unknown;
    stubCommand(async (_ctx, config) => {
      received = config;
    });

    await runCommandJob(JSON.stringify({ sections: ["Movies"], custom: 1 }));

    // Validated against the command's own schema (`shuffle` takes only
    // `sections`), so a key it doesn't know — left by an older release, say —
    // is stripped rather than fatal or silently handed through.
    assert.deepEqual(received, { sections: ["Movies"] });
  });
});

describe("log pipeline", () => {
  it("appends across flushes rather than rewriting the column", async () => {
    insertRun("running");
    stubCommand(async (ctx) => {
      ctx.log("first");
      ctx.log("second");
      ctx.log("third");
    });

    await runCommandJob();

    assert.equal(unstamped(row()?.log), "first\nsecond\nthird\n");
    assert.ok(
      (row()?.log ?? "")
        .split("\n")
        .filter(Boolean)
        .every((l) => parseLogLine(l).at),
      "every line carries the time it was written",
    );
  });

  it("preserves a pre-existing log prefix", async () => {
    // Proves the write is `log = log || chunk` and not a whole-column replace.
    insertRun("running");
    db.update(jobRuns).set({ log: "PREFIX\n" }).where(eq(jobRuns.id, RUN_ID)).run();
    stubCommand(async (ctx) => ctx.log("appended"));

    await runCommandJob();

    assert.equal(unstamped(row()?.log), "PREFIX\nappended\n");
  });

  it("caps the log but keeps the tail", async () => {
    insertRun("running");
    const line = "x".repeat(1000);
    stubCommand(async (ctx) => {
      // Comfortably past the cap, then some distinctive trailing lines.
      for (let i = 0; i < Math.ceil(JOB_LOG_MAX_BYTES / 1000) + 200; i++) ctx.log(line);
      ctx.log("FINAL-LINE-MARKER");
    });

    await runCommandJob();

    const log = row()?.log ?? "";
    assert.match(log, /log truncated at 2 MB/);
    assert.match(log, /further line\(s\) suppressed/);
    // The tail is the part anyone reads on a failure — it must survive.
    assert.match(log, /FINAL-LINE-MARKER/);
    // And the whole thing stays bounded.
    assert.ok(log.length < JOB_LOG_MAX_BYTES * 1.2, `log grew to ${log.length} bytes`);
  });

  it("records the error on the failure path", async () => {
    insertRun("running");
    stubCommand(async () => {
      throw new Error("boom");
    });

    await runCommandJob();

    assert.equal(row()?.status, "failed");
    assert.match(row()?.log ?? "", /Error: boom/);
    assert.notEqual(row()?.finishedAt, null);
  });
});

describe("cancellation", () => {
  it("writes the terminal `cancelled` itself, not `completed`", async () => {
    insertRun("running");
    stubCommand(async () => {
      // The API requests cancellation mid-run; the row moves to `cancelling`.
      cancelRun(RUN_ID);
    });

    const result = await runCommandJob();

    assert.deepEqual(result, { cancelled: true });
    const finished = row();
    assert.equal(finished?.status, "cancelled");
    // Now — and only now — does the run have an end time.
    assert.notEqual(finished?.finishedAt, null);
  });

  it("reports cancellation even when the command throws on abort", async () => {
    insertRun("running");
    stubCommand(async () => {
      cancelRun(RUN_ID);
      throw new Error("AbortError");
    });

    const result = await runCommandJob();

    assert.deepEqual(result, { cancelled: true });
    assert.equal(row()?.status, "cancelled");
  });

  it("discards the checkpoint, so a re-run starts over", async () => {
    // A crash resumes; a cancel starts fresh. Cancelling is deliberate, and
    // "cancel, then Run now" reads as "start over" — redoing work is cheap,
    // silently skipping work the user asked to redo is not.
    insertRun("running");
    stubCommand(async (ctx) => {
      ctx.checkpoint.write({ completedRuleIds: ["a", "b"] });
      cancelRun(RUN_ID);
    });

    await runCommandJob();

    assert.equal(makeCheckpoint(JOB_ID).read(), null);
  });

  it("does not overwrite a run the watchdog already failed", async () => {
    insertRun("running");
    stubCommand(async () => {
      cancelRun(RUN_ID);
      // Watchdog gives up on the cancellation while the command is unwinding.
      db.update(jobRuns).set({ status: "failed", finishedAt: Date.now() }).where(eq(jobRuns.id, RUN_ID)).run();
    });

    await runCommandJob();

    assert.equal(row()?.status, "failed");
  });
});

describe("the cross-domain edges inside a worker", () => {
  /**
   * The bug this whole seam exists to prevent.
   *
   * A Sidequest worker thread runs none of `apps/server`, and these four edges
   * used to be module-level `let`s in `@tinkerbell/core` that each defaulted to
   * a no-op. Nothing in the worker assigned them, so a job's notification
   * suppression traces, health reports, post-sync provider rescans and per-user
   * collection counts all silently did nothing — no error, no log line.
   *
   * They are container registrations now. Asserted through the observable end
   * of one: emitting through the port has to land in the events table.
   */
  it("reach a real implementation, not a no-op default", () => {
    db.delete(events).run();

    const emitEvent = c.resolve(EventBusToken);
    emitEvent("notification.suppressed", "quiet hours", { service: "discord" });

    const rows = db.select().from(events).all();
    assert.equal(rows.length, 1, "the event port must not be a no-op inside a worker");
    assert.equal(rows[0].type, "notification.suppressed");
  });

  it("cannot be silently absent — an unregistered port fails to resolve", async () => {
    // The property that replaces "remember to call registerCoreHooks()": a
    // container built without the health domain does not quietly report health
    // to nobody, it refuses to hand out a reporter at all.
    const { createContainer } = await import("@tinkerbell/container");
    const bare = createContainer(() => {});
    assert.throws(() => bare.resolve(EventBusToken), /No registration for "events.bus"/);
    await bare.dispose();
  });
});
