import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPreset, packChain, SCHEDULE_PRESETS } from "./job-schedule-presets.ts";
import { JOB_ORDER } from "./job-schedule-meta.ts";
import { parseSchedule } from "./job-schedule.ts";
import { MINUTE_MS } from "./job-schedule.ts";
import { planFromContext, validateSchedulePlan } from "./job-schedule-validate.ts";
import { ALL_CAPABILITIES, fixtureContext, NO_CAPABILITIES } from "./job-schedule.fixture.ts";

const MATRIX = [
  { name: "everything configured", ctx: () => fixtureContext() },
  { name: "nothing configured", ctx: () => fixtureContext({ capabilities: NO_CAPABILITIES, features: false }) },
  { name: "no *Arr", ctx: () => fixtureContext({ capabilities: { ...ALL_CAPABILITIES, arr: false } }) },
  { name: "no features installed", ctx: () => fixtureContext({ features: false }) },
  { name: "window off", ctx: () => fixtureContext({ window: false }) },
];

/**
 * A custom cron (a monthly one, say) is checked over the week starting now, so
 * without a fixed clock this test only caught a clash on the 1st in a week
 * that held one — it passed for weeks, then failed on a Sunday in October.
 * Both kinds of week, every time.
 */
const WEEKS = [
  { name: "a week with a 1st in it", now: Date.parse("2026-10-25T12:00:00Z") },
  { name: "a week without", now: Date.parse("2026-10-11T12:00:00Z") },
];

describe("schedule presets", () => {
  for (const preset of SCHEDULE_PRESETS) {
    for (const { name, ctx: make } of MATRIX) {
      for (const week of WEEKS)
        it(`${preset.name} is free of errors and warnings with ${name}, in ${week.name}`, (t) => {
          t.mock.timers.enable({ apis: ["Date"], now: week.now });
          const ctx = make();
          const plan = buildPreset(preset.id, ctx, planFromContext(ctx));
          const issues = validateSchedulePlan(plan, ctx).filter(
            // Not the preset's to fix: a job installed without the service it needs.
            (i) => i.severity !== "info" && i.code !== "service-missing",
          );
          assert.deepEqual(
            issues.map((i) => i.message),
            [],
          );
        });
    }

    it(`${preset.name} only names jobs that exist, and is deterministic`, () => {
      const ctx = fixtureContext({ features: false });
      const a = buildPreset(preset.id, ctx, planFromContext(ctx));
      const b = buildPreset(preset.id, ctx, planFromContext(ctx));
      assert.deepEqual(a, b);
      assert.deepEqual(Object.keys(a.jobs).sort(), ctx.jobs.map((j) => j.id).sort());
    });

    it(`${preset.name} never switches a job on or off, or schedules a manual one`, () => {
      const ctx = fixtureContext();
      const base = planFromContext(ctx);
      base.jobs.cleanup = { schedule: "", enabled: true };
      base.jobs.healthcheck = { schedule: "", enabled: true };
      base.jobs.digest = { schedule: "0 9 * * 1", enabled: false };
      const plan = buildPreset(preset.id, ctx, base);
      for (const [id, entry] of Object.entries(plan.jobs)) assert.equal(entry.enabled, base.jobs[id].enabled, id);
      assert.equal(plan.jobs.cleanup.schedule, "");
      assert.equal(plan.jobs.healthcheck.schedule, "");
      assert.equal(plan.jobs.overlays.schedule, "");
    });
  }

  it("Recommended packs by measured duration rather than a fixed table", () => {
    const ctx = fixtureContext({ features: false });
    ctx.jobs.find((j) => j.id === "generate")!.typicalMs = 150 * MINUTE_MS;
    const plan = buildPreset("recommended", ctx, planFromContext(ctx));
    const at = (id: string) => (parseSchedule(plan.jobs[id].schedule) as { time: number }).time;
    // generate starts 02:00 and takes 150 min × 1.25 → the next default-lane job waits for it.
    assert.ok(at("metadata") >= at("generate") + 187);
  });
});

describe("packChain", () => {
  it("respects every ordering edge and runs a queue one job at a time", () => {
    const ctx = fixtureContext();
    const jobs = ctx.jobs.filter((j) =>
      ["sync-media", "sync-collections", "generate", "cleanup", "purge-runs", "backup"].includes(j.id),
    );
    const times = packChain(jobs, 60, 0);
    const dur = (id: string) => (jobs.find((j) => j.id === id)!.typicalMs ?? 0) / MINUTE_MS;
    for (const e of JOB_ORDER) {
      if (times[e.before] === undefined || times[e.after] === undefined) continue;
      assert.ok(times[e.after] >= times[e.before], `${e.before} → ${e.after}`);
    }
    assert.equal(times["sync-media"], 60);
    // purge-runs is internal: it doesn't queue behind sync-media.
    assert.equal(times["purge-runs"], 60);
    assert.ok(times["sync-collections"] >= 60 + dur("sync-media"));
  });
});
