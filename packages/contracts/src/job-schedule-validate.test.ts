import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFix,
  diffSchedulePlans,
  hasBlockingIssues,
  inWindow,
  planFromContext,
  validateSchedulePlan,
  type ScheduleContext,
  type ScheduleIssue,
  type SchedulePlan,
} from "./job-schedule-validate.ts";
import { fixtureContext, NO_CAPABILITIES } from "./job-schedule.fixture.ts";
import { MINUTE_MS } from "./job-schedule.ts";

function withJobs(
  ctx: ScheduleContext,
  jobs: Record<string, Partial<{ schedule: string; enabled: boolean }>>,
): SchedulePlan {
  const plan = planFromContext(ctx);
  return applyFix(plan, { label: "", jobs });
}

function codes(issues: ScheduleIssue[], jobId?: string): string[] {
  return issues.filter((i) => !jobId || i.jobIds.includes(jobId)).map((i) => i.code);
}

/** A context with every job on a tidy, warning-free schedule, so each test adds exactly one problem. */
function tidy(): ScheduleContext {
  const ctx = fixtureContext({ features: false });
  const times: Record<string, string> = {
    "sync-media": "0 1 * * *",
    "sync-collections": "30 1 * * *",
    "sync-arr": "45 1 * * *",
    "scan-problems": "55 1 * * *",
    generate: "0 2 * * *",
    metadata: "45 2 * * *",
    "metadata-overrides": "15 3 * * *",
    "purge-runs": "0 1 * * *",
    backup: "15 1 * * *",
    cleanup: "30 3 * * *",
    "collection-art": "0 4 * * *",
    "posters-refresh": "30 4 * * 0",
    "registry-updates": "0 6 * * *",
  };
  for (const job of ctx.jobs) if (times[job.id]) job.schedule = times[job.id];
  ctx.settings = { ...ctx.settings, timezone: "UTC" };
  return ctx;
}

describe("validateSchedulePlan", () => {
  it("is quiet about a tidy schedule", () => {
    const ctx = tidy();
    assert.deepEqual(
      validateSchedulePlan(planFromContext(ctx), ctx).filter((i) => i.severity !== "info"),
      [],
    );
  });

  it("errors on an invalid cron, and blocks only when it's the edit being saved", () => {
    const ctx = tidy();
    const issues = validateSchedulePlan(withJobs(ctx, { cleanup: { schedule: "61 * * * *" } }), ctx);
    assert.deepEqual(codes(issues, "cleanup"), ["invalid-cron"]);
    assert.ok(hasBlockingIssues(issues));
    assert.equal(issues[0].fixes[0].jobs?.cleanup?.schedule, "30 3 * * *");

    // The same bad row, already stored: reported, but it doesn't trap the page.
    const stored = tidy();
    stored.jobs.find((j) => j.id === "cleanup")!.schedule = "61 * * * *";
    const untouched = validateSchedulePlan(planFromContext(stored), stored);
    assert.deepEqual(codes(untouched, "cleanup"), ["invalid-cron"]);
    assert.ok(!hasBlockingIssues(untouched));
  });

  it("errors on a schedule that never fires", () => {
    const ctx = tidy();
    assert.deepEqual(codes(validateSchedulePlan(withJobs(ctx, { cleanup: { schedule: "0 0 31 2 *" } }), ctx)), [
      "never-fires",
    ]);
  });

  it("refuses a heavy job more often than its timeout, and warns below six hours", () => {
    const ctx = tidy();
    // generate's budget is 4h.
    const tooOften = validateSchedulePlan(withJobs(ctx, { generate: { schedule: "0 */2 * * *" } }), ctx);
    assert.ok(codes(tooOften, "generate").includes("interval-below-timeout"));
    assert.ok(hasBlockingIssues(tooOften));
    ctx.settings = { ...ctx.settings, maintenanceWindow: { ...ctx.settings.maintenanceWindow, enabled: false } };
    const often = validateSchedulePlan(withJobs(ctx, { "sync-collections": { schedule: "0 */2 * * *" } }), ctx);
    assert.deepEqual(codes(often, "sync-collections"), ["frequent-heavy"]);
  });

  it("only lets playback-poll run more than once a minute", () => {
    const ctx = tidy();
    assert.deepEqual(codes(validateSchedulePlan(withJobs(ctx, { healthcheck: { schedule: "*/30 * * * * *" } }), ctx)), [
      "sub-minute",
    ]);
    assert.deepEqual(
      codes(validateSchedulePlan(withJobs(ctx, { "playback-poll": { schedule: "*/15 * * * * *" } }), ctx)),
      [],
    );
  });

  it("guards always-on, pinned and one-shot jobs", () => {
    const ctx = tidy();
    assert.ok(
      codes(validateSchedulePlan(withJobs(ctx, { generate: { enabled: false } }), ctx)).includes("always-on-disabled"),
    );
    assert.deepEqual(
      codes(validateSchedulePlan(withJobs(ctx, { "rule-schedules": { schedule: "*/5 * * * *" } }), ctx)),
      ["pinned-changed"],
    );
    assert.deepEqual(codes(validateSchedulePlan(withJobs(ctx, { label: { schedule: "0 3 * * *" } }), ctx)), [
      "not-schedulable",
    ]);
  });

  it("treats an essential job left manual by severity", () => {
    const ctx = tidy();
    const purge = validateSchedulePlan(withJobs(ctx, { "purge-runs": { schedule: "" } }), ctx);
    assert.equal(purge.find((i) => i.code === "essential-manual")?.severity, "error");
    const sync = validateSchedulePlan(withJobs(ctx, { "sync-users": { schedule: "" } }), ctx);
    assert.equal(sync.find((i) => i.code === "essential-manual")?.severity, "warning");
  });

  it("warns when a heavy job starts outside the window, including across midnight", () => {
    const ctx = tidy();
    const issues = validateSchedulePlan(withJobs(ctx, { "collection-art": { schedule: "0 20 * * *" } }), ctx);
    assert.deepEqual(codes(issues, "collection-art"), ["outside-window"]);
    assert.equal(issues[0].fixes[0].jobs?.["collection-art"]?.schedule, "0 1 * * *");

    assert.ok(inWindow(30, 22 * 60, 6 * 60));
    assert.ok(inWindow(23 * 60, 22 * 60, 6 * 60));
    assert.ok(!inWindow(12 * 60, 22 * 60, 6 * 60));
  });

  it("warns about a job that needs a service nobody configured, but not one that waits for it", () => {
    const ctx = fixtureContext({ capabilities: NO_CAPABILITIES });
    const issues = validateSchedulePlan(planFromContext(ctx), ctx);
    assert.ok(codes(issues, "digest").includes("service-missing"));
    assert.ok(!codes(issues, "seerr-poll").includes("service-missing"));
  });

  it("reports an ordering edge broken, with fixes that each resolve it", () => {
    const ctx = tidy();
    const plan = withJobs(ctx, { generate: { schedule: "15 1 * * *" } });
    const order = validateSchedulePlan(plan, ctx).filter((i) => i.code === "order");
    // generate at 01:15 now precedes sync-collections (01:30)
    assert.deepEqual(
      order.map((i) => i.jobIds),
      [["sync-collections", "generate"]],
    );
    assert.ok(order[0].fixes.length > 0);
    for (const fix of order[0].fixes) {
      assert.ok(!validateSchedulePlan(applyFix(plan, fix), ctx).some((i) => i.key === order[0].key), fix.label);
    }
  });

  it("offers to move the earlier job when the later one can't follow it", () => {
    const ctx = tidy();
    // The night starts at the window's 01:00, so a 00:45 generate is the last
    // thing in it — nothing can be moved after it.
    const plan = withJobs(ctx, { generate: { schedule: "45 0 * * *" } });
    const issue = validateSchedulePlan(plan, ctx).find((i) => i.key === "order:generate,cleanup")!;
    assert.deepEqual(
      issue.fixes.map((f) => Object.keys(f.jobs ?? {})),
      [["generate"]],
    );
  });

  it("reads 23:30 → 00:30 as in order when there's no window", () => {
    const ctx = tidy();
    ctx.settings = { ...ctx.settings, maintenanceWindow: { ...ctx.settings.maintenanceWindow, enabled: false } };
    const plan = withJobs(ctx, {
      "sync-media": { schedule: "30 23 * * *" },
      "sync-collections": { schedule: "0 0 * * *" },
      generate: { schedule: "30 0 * * *" },
    });
    assert.deepEqual(
      codes(validateSchedulePlan(plan, ctx)).filter((c) => c === "order"),
      [],
    );
  });

  it("calls an overlap on one queue a late start, and ignores internal jobs", () => {
    const ctx = tidy();
    ctx.jobs.find((j) => j.id === "generate")!.typicalMs = 90 * MINUTE_MS;
    const issues = validateSchedulePlan(withJobs(ctx, { "collection-art": { schedule: "0 3 * * *" } }), ctx);
    // generate 02:00 + 90 min overlaps metadata (02:45) and collection-art (03:00)
    assert.ok(issues.some((i) => i.code === "lane-overlap" && i.jobIds.includes("collection-art")));
    const internal = validateSchedulePlan(withJobs(ctx, { backup: { schedule: "0 1 * * *" } }), ctx);
    assert.ok(
      !internal.some((i) => (i.code === "lane-overlap" || i.code === "same-start") && i.jobIds.includes("backup")),
    );
  });

  it("flags two jobs starting together on one queue", () => {
    const ctx = tidy();
    const issues = validateSchedulePlan(withJobs(ctx, { "collection-art": { schedule: "30 3 * * *" } }), ctx);
    assert.ok(issues.some((i) => i.code === "same-start"));
  });

  it("validates the settings that came along with the plan", () => {
    const ctx = tidy();
    const plan = planFromContext(ctx);
    const bad: SchedulePlan = { ...plan, settings: { ...plan.settings, timezone: "Mars/Olympus" } };
    const issues = validateSchedulePlan(bad, ctx);
    assert.deepEqual(codes(issues), ["invalid-timezone"]);
    assert.ok(hasBlockingIssues(issues));
    const window: SchedulePlan = {
      ...plan,
      settings: { ...plan.settings, maintenanceWindow: { enabled: true, from: "", to: "06:00" } },
    };
    assert.ok(codes(validateSchedulePlan(window, ctx)).includes("invalid-window"));
  });

  it("every fix offered resolves the issue it was offered for", () => {
    const ctx = fixtureContext();
    const plan = planFromContext(ctx);
    for (const issue of validateSchedulePlan(plan, ctx)) {
      for (const fix of issue.fixes) {
        const after = validateSchedulePlan(applyFix(plan, fix), ctx);
        assert.ok(!after.some((i) => i.key === issue.key), `"${fix.label}" resolves ${issue.key}`);
      }
    }
  });
});

describe("diffSchedulePlans", () => {
  it("lists only real changes", () => {
    const ctx = tidy();
    const base = planFromContext(ctx);
    const next = applyFix(base, {
      label: "",
      jobs: { cleanup: { schedule: "0 5 * * *" }, generate: { schedule: "0 2 * * 0-6" } },
    });
    assert.deepEqual(
      diffSchedulePlans(base, next).map((d) => d.jobId),
      ["cleanup"],
    );
  });
});
