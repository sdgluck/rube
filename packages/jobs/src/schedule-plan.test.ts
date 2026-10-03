/**
 * `updateSchedules`: the Schedule page's whole-page save.
 *
 * What it must guarantee: everything or nothing is written, a save over
 * somebody else's edit is refused rather than reverting it, the live crons
 * follow the rows, and the whole edit is one entry in History.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken } from "@tinkerbell/core";
import { DbToken, changeLog, jobRuns, jobs } from "@tinkerbell/db";
import { buildPreset, planFromContext } from "@tinkerbell/contracts";
import { createRunner, JobUpdateError } from "./runner.ts";
import { cronJobs } from "./schedule.ts";
import { createSchedulePlan, JobScheduleConflictError } from "./schedule-plan.ts";

const c = createTestContainer();
after(() => {
  for (const cron of cronJobs.values()) cron.stop();
  cronJobs.clear();
  c.dispose();
});

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const config = c.resolve(ConfigStoreToken);
const { seedDefaultJobs } = createRunner(services);
const { scheduleContext, updateSchedules, applyToUntouchedDefaults } = createSchedulePlan(services);

function row(id: string) {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()!;
}

function expected(id: string) {
  const r = row(id);
  return { schedule: r.schedule, enabled: r.enabled === 1 };
}

function scheduleEntries() {
  return db
    .select()
    .from(changeLog)
    .all()
    .filter((r) => r.entity === "schedule");
}

beforeEach(() => {
  db.delete(changeLog).run();
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  seedDefaultJobs();
  config.setConfig("global_timezone", "UTC", { record: false });
  config.setConfig("jobs_maintenance_window", { enabled: true, from: "01:00", to: "06:00" }, { record: false });
});

describe("scheduleContext", () => {
  it("describes every job with its lane, timeout and default", () => {
    const ctx = scheduleContext();
    const generate = ctx.jobs.find((j) => j.id === "generate")!;
    assert.equal(generate.lane, "default");
    assert.equal(generate.timeoutMs, 4 * 3_600_000);
    assert.equal(generate.defaultSchedule, "0 1 * * *");
    assert.equal(generate.alwaysOn, true);
    assert.equal(ctx.jobs.find((j) => j.id === "backup")!.lane, "internal");
    assert.ok(ctx.notInstalled.some((f) => f.id === "digest"));
  });

  it("measures typical durations from completed runs only", () => {
    const at = Date.now() - 3_600_000;
    const runs = [10, 20, 30, 40, 50].map((min, i) => ({
      id: `r${i}`,
      jobId: "generate",
      status: "completed",
      log: "",
      progress: 1,
      message: "",
      startedAt: at - i * 86_400_000,
      finishedAt: at - i * 86_400_000 + min * 60_000,
    }));
    db.insert(jobRuns).values(runs).run();
    db.insert(jobRuns)
      .values({ ...runs[0], id: "failed", status: "failed", finishedAt: at + 5 * 3_600_000 })
      .run();
    const generate = scheduleContext().jobs.find((j) => j.id === "generate")!;
    assert.equal(generate.typicalMs, 30 * 60_000);
    assert.equal(generate.samples, 5);
  });
});

describe("updateSchedules", () => {
  it("writes many jobs and the window in one go, as one History entry", () => {
    updateSchedules({
      jobs: [
        { jobId: "sync-media", schedule: "0 1 * * *", expected: expected("sync-media") },
        { jobId: "sync-collections", schedule: "30 1 * * *", expected: expected("sync-collections") },
        { jobId: "generate", schedule: "0 2 * * *", expected: expected("generate") },
      ],
      settings: {
        values: { maintenanceWindow: { enabled: true, from: "00:30", to: "06:00" } },
        expected: { maintenanceWindow: { enabled: true, from: "01:00", to: "06:00" } },
      },
      summary: "test",
    });
    assert.equal(row("sync-media").schedule, "0 1 * * *");
    assert.equal(row("generate").schedule, "0 2 * * *");
    assert.deepEqual(config.getConfig("jobs_maintenance_window"), { enabled: true, from: "00:30", to: "06:00" });

    const entries = scheduleEntries();
    assert.equal(entries.length, 1);
    // …and no separate settings-edit row for the window.
    assert.equal(
      db
        .select()
        .from(changeLog)
        .all()
        .filter((r) => r.entity === "config").length,
      0,
    );
    const after = entries[0].after as { summary: string; jobs: Record<string, unknown> };
    assert.equal(after.summary, "test");
    assert.deepEqual(Object.keys(after.jobs).sort(), ["generate", "sync-collections", "sync-media"]);
  });

  it("re-points the live cron", () => {
    updateSchedules({
      jobs: [{ jobId: "cleanup", schedule: "15 4 * * *", expected: expected("cleanup") }],
    });
    assert.equal(cronJobs.get("cleanup")?.getPattern(), "15 4 * * *");
  });

  it("refuses a blocking problem and writes nothing", () => {
    const before = row("cleanup").schedule;
    assert.throws(
      () =>
        updateSchedules({
          jobs: [
            { jobId: "sync-media", schedule: "0 1 * * *", expected: expected("sync-media") },
            { jobId: "cleanup", schedule: "0 */2 * * *", expected: expected("cleanup") },
          ],
        }),
      JobUpdateError,
    );
    assert.equal(row("cleanup").schedule, before);
    assert.equal(row("sync-media").schedule, "0 0 * * *");
    assert.equal(scheduleEntries().length, 0);
  });

  it("won't switch off an always-on job", () => {
    assert.throws(
      () => updateSchedules({ jobs: [{ jobId: "generate", enabled: false, expected: expected("generate") }] }),
      /always on/,
    );
  });

  it("refuses a save made against a stale view, naming what moved", () => {
    const stale = expected("cleanup");
    db.update(jobs).set({ schedule: "0 5 * * *" }).where(eq(jobs.id, "cleanup")).run();
    assert.throws(
      () => updateSchedules({ jobs: [{ jobId: "cleanup", schedule: "30 4 * * *", expected: stale }] }),
      (err: unknown) => err instanceof JobScheduleConflictError && err.jobIds.includes("cleanup"),
    );
    assert.equal(row("cleanup").schedule, "0 5 * * *");
  });

  it("rejects an unknown timezone", () => {
    assert.throws(
      () =>
        updateSchedules({
          jobs: [],
          settings: { values: { timezone: "Mars/Olympus" }, expected: { timezone: "UTC" } },
        }),
      JobUpdateError,
    );
  });

  it("rebuilds every cron when the timezone changes", () => {
    updateSchedules({
      jobs: [],
      settings: { values: { timezone: "America/New_York" }, expected: { timezone: "UTC" } },
    });
    assert.equal(config.getConfig("global_timezone"), "America/New_York");
    assert.ok(cronJobs.size > 0);
    assert.equal(scheduleEntries().length, 1);
  });

  it("does nothing, and logs nothing, when nothing changed", () => {
    updateSchedules({ jobs: [{ jobId: "cleanup", schedule: row("cleanup").schedule, expected: expected("cleanup") }] });
    assert.equal(scheduleEntries().length, 0);
  });
});

describe("applyToUntouchedDefaults", () => {
  it("moves only the jobs still on their shipped schedule", () => {
    db.update(jobs).set({ schedule: "45 4 * * *" }).where(eq(jobs.id, "cleanup")).run();
    const ctx = scheduleContext();
    const moved = applyToUntouchedDefaults(buildPreset("recommended", ctx, planFromContext(ctx)), "setup");
    assert.ok(moved.includes("sync-media"));
    assert.ok(!moved.includes("cleanup"));
    assert.equal(row("cleanup").schedule, "45 4 * * *");
    assert.equal(row("sync-media").schedule, "0 1 * * *");
  });
});
