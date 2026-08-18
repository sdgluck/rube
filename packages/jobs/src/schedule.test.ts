import { cronJobs } from "./schedule.ts";
/**
 * Catch-up is the riskiest scheduling behaviour: get it wrong in one direction
 * and a missed nightly job never runs, get it wrong in the other and boot
 * stampedes every job in the system.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken } from "@tinkerbell/db";
import { ConfigStoreToken } from "@tinkerbell/core";
import { config, jobRuns, jobs } from "@tinkerbell/db";
import { createSchedule } from "./schedule.ts";
import { JobStarterToken, registerJobs } from "@tinkerbell/jobs";
import { DAY_MS, HOUR_MS } from "@tinkerbell/core";

/**
 * Which job ids the scheduler actually asked to start.
 *
 * Registered over `JobStarterToken` — the same edge the runner binds in
 * production — rather than assigned to a module-level slot, which is what
 * `initSchedule` used to do and why an unwired process failed silently.
 *
 * Asserted by membership rather than by count: catch-up starts are staggered
 * timeouts, so an earlier test's timer can still land in here.
 */
const startedJobIds: string[] = [];

const c = createTestContainer({
  overrides: (r) => {
    registerJobs(r);
    r.replace(JobStarterToken, () => async (jobId: string) => {
      startedJobIds.push(jobId);
      return { ok: true as const, runId: "x" };
    });
  },
});
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { catchUpMissedRuns, clearDeferredStarts, deferredStarts, scheduleCron, schedulerTimezone, startCronSchedules } =
  createSchedule(services);
const { setConfig, deleteConfig } = c.resolve(ConfigStoreToken);

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
    startedJobIds.length = 0;
    seedJob("nightly", "0 3 * * *");
    // Last ran the morning before the missed 03:00 occurrence.
    seedRun("nightly", NOW - 2 * DAY_MS);

    assert.deepEqual(catchUpMissedRuns(NOW), ["nightly"]);
  });

  it("fires for a job that has never run", () => {
    seedJob("nightly", "0 3 * * *");
    assert.deepEqual(catchUpMissedRuns(NOW), ["nightly"]);
  });

  it("does not fire when a run already happened after the occurrence", () => {
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
    seedJob("frequent", "*/15 * * * *");
    seedJob("half-hourly", "*/30 * * * *");

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("still catches up an hourly schedule", () => {
    seedJob("hourly", "0 * * * *");
    seedRun("hourly", NOW - 5 * HOUR_MS);

    assert.deepEqual(catchUpMissedRuns(NOW), ["hourly"]);
  });

  it("ignores disabled and unscheduled jobs", () => {
    seedJob("disabled", "0 3 * * *", 0);
    seedJob("manual", "");

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("does not resurrect an occurrence older than a day", () => {
    // Runs on the 1st of January only — the last occurrence is months back.
    seedJob("annual", "0 3 1 1 *");

    assert.deepEqual(catchUpMissedRuns(NOW), []);
  });

  it("holds a caught-up job back when the maintenance window says so", async () => {
    // Catch-up used to call `startJob` directly, so a restart in the evening
    // stampeded every heavy job past the gate that exists to keep them out of
    // it. It is the scheduler deciding to work, so the window applies.
    startedJobIds.length = 0;
    // `generate` is on the deferrable list; the window is the small hours.
    seedJob("generate", "0 3 * * *");
    setConfig("jobs_maintenance_window", { enabled: true, from: "01:00", to: "06:00" });

    // Still reported as due — the occurrence was missed either way.
    assert.deepEqual(catchUpMissedRuns(NOW), ["generate"]);
    // …but held rather than started. The stagger is a timeout, so let it fire.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(!startedJobIds.includes("generate"), "the held job should not have started");
    assert.deepEqual(
      deferredStarts().map((d) => d.jobId),
      ["generate"],
    );
  });

  it("starts a caught-up job when nothing is holding it back", async () => {
    startedJobIds.length = 0;
    seedJob("generate", "0 3 * * *");

    assert.deepEqual(catchUpMissedRuns(NOW), ["generate"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(startedJobIds.includes("generate"));
    assert.deepEqual(deferredStarts(), []);
  });

  it("survives an unparseable schedule without taking the boot down", () => {
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
    assert.doesNotThrow(() => scheduleCron({ id: "broken", name: "Broken", enabled: 1, schedule: "nope" }));
    assert.equal(cronJobs.has("broken"), false);
  });

  it("schedules the good jobs even when a bad one is present", () => {
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
