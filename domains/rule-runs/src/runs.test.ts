import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-rule-runs-test-");

type Runs = typeof import("./runs.ts");
type Db = typeof import("@tinkerbell/db");

let runs: Runs;
let dbmod: Db;
let ruleSeq = 0;

/** A rule to hang runs off — `rule_runs.rule_id` is a real foreign key. */
function makeRule(): string {
  const id = `rule-${++ruleSeq}`;
  dbmod.db
    .insert(dbmod.rules)
    .values({ id, name: `Rule ${ruleSeq}`, type: "smart_filter", createdAt: Date.now() })
    .run();
  return id;
}

before(async () => {
  runs = await import("./runs.ts");
  dbmod = await import("@tinkerbell/db");
});

describe("attaching to a run already in flight", () => {
  test("an active run is findable; a finished one is not", () => {
    const ruleId = makeRule();
    assert.equal(runs.findActiveRuleRun(ruleId), null);

    const runId = runs.createRuleRun({ ruleId, phase: "run", trigger: "manual" });
    // Queued counts as active: the work is committed to, just not started, and
    // pressing Run again should join it rather than queue a second one.
    assert.equal(runs.findActiveRuleRun(ruleId)?.id, runId);

    const handle = runs.activateRuleRun(runId);
    assert.ok(handle);
    assert.equal(runs.findActiveRuleRun(ruleId)?.status, "running");

    handle.finish({ status: "ok", collectionCount: 3, itemCount: 30 });
    assert.equal(runs.findActiveRuleRun(ruleId), null);

    const finished = runs.getRuleRun(runId);
    assert.equal(finished?.status, "ok");
    assert.equal(finished?.collectionCount, 3);
    assert.equal(finished?.progress, 1);
    assert.ok(finished?.finishedAt);
  });

  test("phase separates a test from a run of the same rule", () => {
    const ruleId = makeRule();
    const testRunId = runs.createRuleRun({ ruleId, phase: "test", trigger: "manual" });
    assert.equal(runs.findActiveRuleRun(ruleId, "run"), null);
    assert.equal(runs.findActiveRuleRun(ruleId, "test")?.id, testRunId);
  });
});

describe("cancellation", () => {
  test("a queued run is cancelled outright and never activates", () => {
    const ruleId = makeRule();
    const runId = runs.createRuleRun({ ruleId, phase: "run", trigger: "manual" });

    assert.equal(runs.requestRuleRunCancel(runId), "cancelled");
    assert.equal(runs.getRuleRun(runId)?.status, "cancelled");
    // The claim must fail, or the queue would execute work the user stopped.
    assert.equal(runs.activateRuleRun(runId), null);
  });

  test("a running run is asked to stop, and its executor writes the ending", () => {
    const ruleId = makeRule();
    const handle = runs.startRuleRun({ ruleId, phase: "run", trigger: "manual" });

    assert.equal(runs.requestRuleRunCancel(handle.runId), "cancelling");
    assert.equal(runs.getRuleRun(handle.runId)?.status, "cancelling");
    // Same process, so the abort is immediate rather than waiting for a poll.
    assert.equal(handle.cancelRequested(), true);
    assert.equal(handle.ctx.signal.aborted, true);

    handle.finish({ status: "cancelled" });
    assert.equal(runs.getRuleRun(handle.runId)?.status, "cancelled");
  });

  test("cancelling a finished run does nothing", () => {
    const ruleId = makeRule();
    const handle = runs.startRuleRun({ ruleId, phase: "run", trigger: "manual" });
    handle.finish({ status: "ok" });
    assert.equal(runs.requestRuleRunCancel(handle.runId), null);
    assert.equal(runs.getRuleRun(handle.runId)?.status, "ok");
  });
});

describe("the log", () => {
  test("lines accumulate and slice by offset", () => {
    const ruleId = makeRule();
    const handle = runs.startRuleRun({ ruleId, phase: "run", trigger: "manual" });
    handle.ctx.log("first line");
    handle.ctx.log("second line");
    handle.finish({ status: "ok" });

    const whole = runs.getRuleRunLog(handle.runId);
    assert.ok(whole);
    assert.equal(whole.chunk, "first line\nsecond line\n");
    assert.equal(whole.size, whole.chunk.length);

    // The incremental read the UI does: everything after what it already has.
    const tail = runs.getRuleRunLog(handle.runId, "first line\n".length);
    assert.equal(tail?.chunk, "second line\n");
    assert.equal(tail?.nextOffset, whole.nextOffset);
  });

  test("a tee mirrors lines to the owning job's log", () => {
    const ruleId = makeRule();
    const teed: string[] = [];
    const handle = runs.startRuleRun({
      ruleId,
      phase: "run",
      trigger: "job",
      jobRunId: "job-run-1",
      tee: (line) => teed.push(line),
    });
    handle.ctx.log("something happened");
    handle.finish({ status: "ok" });

    assert.deepEqual(teed, ["something happened"]);
    assert.equal(runs.getRuleRunsForJobRun("job-run-1").length, 1);
  });

  test("progress is recorded as a fraction", () => {
    const ruleId = makeRule();
    const handle = runs.startRuleRun({ ruleId, phase: "run", trigger: "manual" });
    handle.ctx.progress(1, 4, "A quarter of the way");
    handle.finish({ status: "error", error: "boom" });

    const row = runs.getRuleRun(handle.runId);
    assert.equal(row?.progress, 0.25);
    assert.equal(row?.message, "Error: boom");
    assert.equal(row?.error, "boom");
  });
});

describe("sweeps", () => {
  test("a restart fails everything that was in flight", () => {
    const ruleId = makeRule();
    const queued = runs.createRuleRun({ ruleId, phase: "run", trigger: "manual" });
    const running = runs.startRuleRun({ ruleId, phase: "test", trigger: "manual" });

    const swept = runs.markStaleRuleRunsAsFailed();
    assert.ok(swept >= 2);
    assert.equal(runs.getRuleRun(queued)?.status, "error");
    assert.equal(runs.getRuleRun(running.runId)?.status, "error");
    assert.match(runs.getRuleRun(queued)?.error ?? "", /restarted/);
  });

  test("the watchdog fails a run that stopped heartbeating, but leaves queued ones alone", () => {
    const ruleId = makeRule();
    const queued = runs.createRuleRun({ ruleId, phase: "run", trigger: "manual" });
    const live = runs.startRuleRun({ ruleId, phase: "test", trigger: "manual" });

    // Nothing is stale yet.
    assert.equal(runs.sweepStuckRuleRuns(), 0);

    // An hour later, with no heartbeat since, the executor is gone.
    const anHourOn = Date.now() + 60 * 60 * 1000;
    assert.equal(runs.sweepStuckRuleRuns(anHourOn), 1);
    assert.equal(runs.getRuleRun(live.runId)?.status, "error");
    // A queued run has no executor to lose — it is waiting, not abandoned.
    assert.equal(runs.getRuleRun(queued)?.status, "queued");

    runs.requestRuleRunCancel(queued);
  });
});

describe("retention", () => {
  test("a rule keeps only its most recent runs", () => {
    const ruleId = makeRule();
    for (let i = 0; i < 60; i++) {
      const handle = runs.startRuleRun({ ruleId, phase: "run", trigger: "manual" });
      handle.finish({ status: "ok" });
    }
    const kept = runs.getRuleRuns(ruleId, { limit: 200 });
    assert.ok(kept.length <= 50, `expected at most 50 retained runs, got ${kept.length}`);
    assert.ok(kept.length > 0);
  });

  test("age-based pruning skips runs still in flight", () => {
    const ruleId = makeRule();
    const live = runs.startRuleRun({ ruleId, phase: "run", trigger: "manual" });

    // A cutoff in the future would otherwise take everything.
    runs.pruneRuleRuns(Date.now() + 60_000);
    assert.ok(runs.getRuleRun(live.runId));

    live.finish({ status: "ok" });
    runs.pruneRuleRuns(Date.now() + 60_000);
    assert.equal(runs.getRuleRun(live.runId), null);
  });
});
