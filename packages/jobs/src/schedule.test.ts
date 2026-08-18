/**
 * Catch-up is the riskiest scheduling behaviour: get it wrong in one direction
 * and a missed nightly job never runs, get it wrong in the other and boot
 * stampedes every job in the system.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "./test-support/temp-db.ts";

setupTempDb();

const { db, config, jobs, jobRuns } = await import("@tinkerbell/db");
const {
  catchUpMissedRuns,
  clearDeferredStarts,
  cronJobs,
  deferredStarts,
  initSchedule,
  scheduleCron,
  schedulerTimezone,
  startCronSchedules,
} = await import("./schedule.ts");
const { setConfig, deleteConfig, DAY_MS, HOUR_MS } = await import("@tinkerbell/core");

/** 2026-08-04T12:00:00Z — a fixed "now" so the assertions don't drift. */
const NOW = Date.parse("2026-08-04T12:00:00Z");

function seedJob(id: string, schedule: string, enabled = 1): void {
  db.insert(jobs).values({ id, name: id, command: "shuffle", schedule, enabled, config: {} }).run();
}

function seedRun(jobId: string, startedAt: number): void {
  db.insert(jobRuns)
    .values({ id: `${jobId}-${startedAt}`, jobId, status: "completed", log: "", progress: 1, message: "", startedAt })
    .run();
}

/**
 * Which job ids a run actually started. Asserted by id rather than by call
 * count: catch-up starts are staggered timeouts, so an earlier test's timer can
 * still land on the current mock.
 */
function startedIds(started: { mock: { calls: Array<{ arguments: unknown[] }> } }): string[] {
  return started.mock.calls.map((call) => call.arguments[0] as string);
}

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  clearDeferredStarts();
  deleteConfig("jobs_maintenance_window");
  deleteConfig("global_timezone");
  // UTC keeps the fixture arithmetic honest regardless of where this runs.
  setConfig("global_timezone", "UTC");
});

describe("catchUpMissedRuns", () => {
  it("fires for a daily job that was missed", () => {
    const started = mock.fn(async () => ({ ok: true as const, runId: "x" }));
    initSchedule(started);
    seedJob("nightly", "0 3 * * *");
    // Last ran the morning before the missed 03:00 occurrence.
    seedRun("nightly", NOW - 2 * DAY_MS);

    assert.deepEqual(catchUpMissedRuns(NOW), ["nightly"]);
  });

  it("fires for a job that has never run", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("nightly", "0 3 * * *");
    assert.deepEqual(catchUpMissedRuns(NOW), ["nightly"]);
  });

  it("does not fire when a run already happened after the occurrence", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("nightly", "0 3 * * *");
    // Ran at 04:00, an hour after the 03:00 occurrence — nothing was missed.
    seedRun("nightly", NOW - 8 * HOUR_MS);

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("never fires for a sub-hourly schedule", () => {
    // `*/15` fires again within minutes; resurrecting a missed one is noise,
    // and doing it for every such job at boot is a stampede. The cutoff is
    // exactly an hour: hourly schedules are still eligible (below), anything
    // more frequent is not.
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("frequent", "*/15 * * * *");
    seedJob("half-hourly", "*/30 * * * *");

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("still catches up an hourly schedule", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("hourly", "0 * * * *");
    seedRun("hourly", NOW - 5 * HOUR_MS);

    assert.deepEqual(catchUpMissedRuns(NOW), ["hourly"]);
  });

  it("ignores disabled and unscheduled jobs", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("disabled", "0 3 * * *", 0);
    seedJob("manual", "");

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("does not resurrect an occurrence older than a day", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    // Runs on the 1st of January only — the last occurrence is months back.
    seedJob("annual", "0 3 1 1 *");

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("holds a caught-up job back when the maintenance window says so", async () => {
    // Catch-up used to call `startJob` directly, so a restart in the evening
    // stampeded every heavy job past the gate that exists to keep them out of
    // it. It is the scheduler deciding to work, so the window applies.
    const started = mock.fn(async () => ({ ok: true as const, runId: "x" }));
    initSchedule(started);
    // `generate` is on the deferrable list; the window is the small hours.
    seedJob("generate", "0 3 * * *");
    setConfig("jobs_maintenance_window", { enabled: true, from: "01:00", to: "06:00" });

    // Still reported as due — the occurrence was missed either way.
    assert.deepEqual(catchUpMissedRuns(NOW), ["generate"]);
    // …but held rather than started. The stagger is a timeout, so let it fire.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(!startedIds(started).includes("generate"), "the held job should not have started");
    assert.deepEqual(
      deferredStarts().map((d) => d.jobId),
      ["generate"],
    );
  });

  it("starts a caught-up job when nothing is holding it back", async () => {
    const started = mock.fn(async () => ({ ok: true as const, runId: "x" }));
    initSchedule(started);
    seedJob("generate", "0 3 * * *");

    assert.deepEqual(catchUpMissedRuns(NOW), ["generate"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(startedIds(started).includes("generate"));
    assert.deepEqual(deferredStarts(), []);
  });

  it("survives an unparseable schedule without taking the boot down", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("broken", "not a cron expression");
    seedJob("nightly", "0 3 * * *");

    // The broken one is skipped; the good one is still evaluated.
    assert.deepEqual(catchUpMissedRuns(NOW), ["nightly"]);
  });
});

describe("scheduleCron", () => {
  it("does not throw when a stored schedule is unparseable", () => {
    // One bad row must not take out the schedules that follow it in
    // `startCronSchedules`'s loop — that loop runs during `initJobs`.
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    assert.doesNotThrow(() => scheduleCron({ id: "broken", name: "Broken", enabled: 1, schedule: "nope" }));
    assert.equal(cronJobs.has("broken"), false);
  });

  it("schedules the good jobs even when a bad one is present", () => {
    initSchedule(async () => ({ ok: true as const, runId: "x" }));
    seedJob("broken", "not a cron expression");
    seedJob("fine", "0 3 * * *");

    assert.doesNotThrow(() => startCronSchedules());
    assert.equal(cronJobs.has("fine"), true);
    assert.equal(cronJobs.has("broken"), false);

    for (const cron of cronJobs.values()) cron.stop();
    cronJobs.clear();
  });
});

describe("schedulerTimezone", () => {
  it("prefers the configured zone", () => {
    setConfig("global_timezone", "Europe/London");
    assert.equal(schedulerTimezone(), "Europe/London");
  });

  it("ignores an invalid stored zone rather than propagating it", () => {
    // croner throws when it builds a schedule against an unknown zone, and
    // that throw happens inside `initJobs` — which the server turns into
    // process.exit(1). A typo in this row must degrade, not crash-loop.
    db.insert(config)
      .values({ key: "global_timezone", value: "Europe/Londn" })
      .onConflictDoUpdate({ target: config.key, set: { value: "Europe/Londn" } })
      .run();
    const original = process.env.TZ;
    delete process.env.TZ;

    assert.equal(schedulerTimezone(), undefined);

    if (original !== undefined) process.env.TZ = original;
  });

  it("ignores an invalid TZ environment variable", () => {
    // The realistic trigger: TZ never goes through the config schema at all.
    deleteConfig("global_timezone");
    const original = process.env.TZ;
    process.env.TZ = "Not/AZone";

    assert.equal(schedulerTimezone(), undefined);

    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("falls back to TZ, then to undefined", () => {
    deleteConfig("global_timezone");
    const original = process.env.TZ;

    process.env.TZ = "Asia/Tokyo";
    assert.equal(schedulerTimezone(), "Asia/Tokyo");

    delete process.env.TZ;
    assert.equal(schedulerTimezone(), undefined);

    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("treats a blank configured zone as unset", () => {
    setConfig("global_timezone", "   ");
    const original = process.env.TZ;
    delete process.env.TZ;
    assert.equal(schedulerTimezone(), undefined);
    if (original !== undefined) process.env.TZ = original;
  });
});
