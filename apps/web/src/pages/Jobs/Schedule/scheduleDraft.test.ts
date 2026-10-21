import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SchedulePlan } from "@rube/contracts";
import { draftReducer, initialDraft, isDirty, toMutation, type DraftAction, type DraftState } from "./scheduleDraft.ts";

const BASE: SchedulePlan = {
  jobs: {
    generate: { schedule: "0 1 * * *", enabled: true },
    cleanup: { schedule: "0 4 * * *", enabled: true },
    digest: { schedule: "0 9 * * MON", enabled: true },
  },
  settings: {
    timezone: "UTC",
    maintenanceWindow: { enabled: true, from: "01:00", to: "06:00" },
    deferWhileStreaming: { enabled: true, maxWaitMinutes: 120, transcodesOnly: false },
  },
};

function run(...actions: DraftAction[]): DraftState {
  return actions.reduce(draftReducer, initialDraft(BASE));
}

describe("draftReducer", () => {
  it("makes a whole drag one undo step", () => {
    const state = run(
      { type: "set-job", jobId: "cleanup", patch: { schedule: "15 4 * * *" }, preview: true },
      { type: "set-job", jobId: "cleanup", patch: { schedule: "30 4 * * *" }, preview: true },
      { type: "set-job", jobId: "cleanup", patch: { schedule: "45 4 * * *" }, preview: true },
      { type: "commit-preview" },
    );
    assert.equal(state.current.jobs.cleanup.schedule, "45 4 * * *");
    assert.equal(state.past.length, 1);
    assert.equal(draftReducer(state, { type: "undo" }).current.jobs.cleanup.schedule, "0 4 * * *");
  });

  it("leaves the draft untouched by a cancelled drag", () => {
    const state = run(
      { type: "set-job", jobId: "cleanup", patch: { schedule: "15 4 * * *" }, preview: true },
      { type: "cancel-preview" },
    );
    assert.equal(state.preview, null);
    assert.ok(!isDirty(state));
  });

  it("makes a preset one undo step, and redo puts it back", () => {
    const preset = {
      ...BASE,
      jobs: {
        ...BASE.jobs,
        generate: { schedule: "0 2 * * *", enabled: true },
        cleanup: { schedule: "0 3 * * *", enabled: true },
      },
    };
    const applied = run({ type: "apply", plan: preset, summary: "Applied Recommended" });
    const undone = draftReducer(applied, { type: "undo" });
    assert.ok(!isDirty(undone));
    const redone = draftReducer(undone, { type: "redo" });
    assert.deepEqual(redone.current, preset);
    assert.equal(toMutation(redone).summary, "Applied Recommended");
  });

  it("sends only what changed, with what it was changed from", () => {
    const state = run(
      { type: "set-job", jobId: "cleanup", patch: { schedule: "30 4 * * *" } },
      { type: "set-settings", patch: { timezone: "Europe/London" } },
    );
    assert.deepEqual(toMutation(state), {
      jobs: [{ jobId: "cleanup", schedule: "30 4 * * *", expected: { schedule: "0 4 * * *", enabled: true } }],
      settings: { values: { timezone: "Europe/London" }, expected: { timezone: "UTC" } },
      summary: undefined,
    });
  });

  it("doesn't count a respelling as a change", () => {
    const state = run({ type: "set-job", jobId: "digest", patch: { schedule: "0 9 * * 1" } });
    assert.ok(!isDirty(state));
    assert.deepEqual(toMutation(state).jobs, []);
  });

  it("reverts one job to how it was saved", () => {
    const state = run(
      { type: "set-job", jobId: "cleanup", patch: { schedule: "30 4 * * *" } },
      { type: "set-job", jobId: "generate", patch: { schedule: "0 2 * * *" } },
      { type: "revert-job", jobId: "cleanup" },
    );
    assert.deepEqual(
      toMutation(state).jobs.map((j) => j.jobId),
      ["generate"],
    );
  });

  it("rebases onto somebody else's save, keeping the user's own edits", () => {
    const mine = run({ type: "set-job", jobId: "cleanup", patch: { schedule: "30 4 * * *" } });
    const server: SchedulePlan = {
      ...BASE,
      jobs: { ...BASE.jobs, generate: { schedule: "0 3 * * *", enabled: true } },
    };
    const rebased = draftReducer(mine, { type: "rebase", server });
    assert.equal(rebased.current.jobs.generate.schedule, "0 3 * * *");
    assert.equal(rebased.current.jobs.cleanup.schedule, "30 4 * * *");
    assert.equal(toMutation(rebased).jobs[0].expected.schedule, "0 4 * * *");
  });

  it("starts clean after a save", () => {
    const saved = draftReducer(run({ type: "set-job", jobId: "cleanup", patch: { schedule: "30 4 * * *" } }), {
      type: "saved",
    });
    assert.ok(!isDirty(saved));
    assert.equal(saved.base.jobs.cleanup.schedule, "30 4 * * *");
  });
});
