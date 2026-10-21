/**
 * Drift guards between contracts' schedule metadata and the jobs that exist.
 *
 * `JOB_SCHEDULE_META` and `JOB_ORDER` are keyed by job id, in a package that
 * can't import this one. Without these tests a renamed job would silently lose
 * its ordering edges and its "heavy" flag — and with it, the deferral gate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HEAVY_JOB_IDS,
  isAlwaysOnJob,
  isSchedulableJob,
  JOB_ORDER,
  JOB_SCHEDULE_META,
  planFromContext,
  validateSchedulePlan,
  type ScheduleContext,
} from "@rube/contracts";
import { DEFAULT_JOBS } from "./runner.ts";
import { FEATURE_TEMPLATES } from "./features.ts";
import { COMMANDS, isCommandName } from "./commands/catalog.ts";
import { DEFERRABLE_JOBS } from "./deferral.ts";

const ALL_IDS = [...DEFAULT_JOBS.map((j) => j.id), ...FEATURE_TEMPLATES.map((f) => f.id)];

describe("schedule metadata", () => {
  it("covers every job, and names no job that doesn't exist", () => {
    assert.deepEqual(
      ALL_IDS.filter((id) => !(id in JOB_SCHEDULE_META)),
      [],
    );
    assert.deepEqual(
      Object.keys(JOB_SCHEDULE_META).filter((id) => !ALL_IDS.includes(id)),
      [],
    );
  });

  it("orders only jobs that exist, without a cycle", () => {
    for (const edge of JOB_ORDER) {
      assert.ok(ALL_IDS.includes(edge.before), edge.before);
      assert.ok(ALL_IDS.includes(edge.after), edge.after);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string) => {
      assert.ok(!visiting.has(id), `cycle through ${id}`);
      if (done.has(id)) return;
      visiting.add(id);
      for (const e of JOB_ORDER) if (e.before === id) visit(e.after);
      visiting.delete(id);
      done.add(id);
    };
    for (const id of ALL_IDS) visit(id);
  });

  it("is what the deferral gate holds back", () => {
    assert.deepEqual([...DEFERRABLE_JOBS].sort(), [...HEAVY_JOB_IDS].sort());
  });

  it("ships no schedule on a job that can't be scheduled", () => {
    for (const job of DEFAULT_JOBS) {
      if (!isSchedulableJob(job.id)) assert.equal(job.schedule, "", job.id);
    }
  });

  it("ships defaults with no errors", () => {
    const ctx: ScheduleContext = {
      serverTimezone: "UTC",
      capabilities: {
        seerr: true,
        arr: true,
        personalizedSharing: true,
        watchlist: true,
        notifier: true,
        backups: true,
      },
      settings: {
        timezone: "Europe/London",
        maintenanceWindow: { enabled: true, from: "01:00", to: "06:00" },
        deferWhileStreaming: { enabled: true, maxWaitMinutes: 120, transcodesOnly: false },
      },
      jobs: [
        ...DEFAULT_JOBS.map((j) => ({ id: j.id, name: j.name, command: j.command, schedule: j.schedule })),
        ...FEATURE_TEMPLATES.map((f) => ({ id: f.id, name: f.name, command: f.command, schedule: f.defaultSchedule })),
      ].map((j) => ({
        id: j.id,
        name: j.name,
        lane: isCommandName(j.command) ? COMMANDS[j.command].lane : ("internal" as const),
        timeoutMs: isCommandName(j.command) ? COMMANDS[j.command].timeoutMs : 30 * 60_000,
        typicalMs: null,
        samples: 0,
        schedule: j.schedule,
        enabled: true,
        defaultSchedule: j.schedule,
        alwaysOn: isAlwaysOnJob(j.id),
        feature: false,
      })),
    };
    const errors = validateSchedulePlan(planFromContext(ctx), ctx).filter((i) => i.severity === "error");
    assert.deepEqual(
      errors.map((i) => i.message),
      [],
    );
  });
});
