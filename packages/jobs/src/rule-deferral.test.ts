/**
 * Rule work started by the server used to ignore the two settings that exist to
 * keep heavy work away from a stream.
 *
 * `deferralFor` is keyed on a job id, and the jobs that run rules outside the
 * nightly batch — `rule-schedules`, `playback-poll`, `sync-recently-added`,
 * `seerr-poll` — are not in `DEFERRABLE_JOBS`, because none of them is heavy in
 * itself. The rules they run are. So ticking "run this rule on its own
 * schedule" quietly moved it out from under the maintenance window and the
 * defer-while-streaming setting, and `item-watched` fired rules from the
 * playback poller: at the one moment a stream is provably open.
 *
 * These cover the gate itself. The hold-and-retry bookkeeping around it lives
 * in `runDueRules`.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "./test-support/temp-db.ts";

setupTempDb();

const { db, playbackSessions } = await import("@tinkerbell/db");
const { setConfig } = await import("@tinkerbell/core");
const { deferralFor, deferralForRuleWork, isDeferrable } = await import("./deferral.ts");

/** An open session — `endedAt` null is what "someone is watching" means here. */
function seedStream(decision: "directplay" | "transcode" = "directplay"): void {
  db.insert(playbackSessions)
    .values({
      id: `session-${decision}-${db.select().from(playbackSessions).all().length}`,
      userId: 1,
      username: "someone",
      ratingKey: "100",
      title: "A Film",
      type: "movie",
      decision,
      startedAt: Date.now(),
      lastSeenAt: Date.now(),
    })
    .run();
}

describe("deferralForRuleWork", () => {
  beforeEach(() => {
    db.delete(playbackSessions).run();
    setConfig("jobs_defer_while_streaming", { enabled: false, transcodesOnly: false, maxWaitMinutes: 120 });
    setConfig("jobs_maintenance_window", { enabled: false, from: "01:00", to: "06:00" });
  });

  it("holds rule work while something is streaming", () => {
    setConfig("jobs_defer_while_streaming", { enabled: true, transcodesOnly: false, maxWaitMinutes: 120 });
    seedStream();

    const verdict = deferralForRuleWork();
    assert.equal(verdict?.kind, "streaming");
    assert.match(verdict?.reason ?? "", /1 stream in progress/);
  });

  it("answers where the job-keyed gate could not", () => {
    // The regression this exists for. `rule-schedules` is the job that runs a
    // rule's own cron, and it is deliberately not deferrable — it is a one-query
    // poll. The *rules* it runs are the heavy part, and nothing was asking.
    setConfig("jobs_defer_while_streaming", { enabled: true, transcodesOnly: false, maxWaitMinutes: 120 });
    seedStream();

    assert.equal(isDeferrable("rule-schedules"), false);
    assert.equal(deferralFor("rule-schedules"), null);
    assert.equal(deferralForRuleWork()?.kind, "streaming");

    // Same for every job that hosts a trigger.
    for (const host of ["playback-poll", "sync-recently-added", "seerr-poll"]) {
      assert.equal(deferralFor(host), null, `${host} is not deferrable as a job`);
    }
  });

  it("honours transcodes-only", () => {
    // A direct play costs the box almost nothing; on a server that rarely
    // transcodes this is the difference between waiting sometimes and always.
    setConfig("jobs_defer_while_streaming", { enabled: true, transcodesOnly: true, maxWaitMinutes: 120 });
    seedStream("directplay");
    assert.equal(deferralForRuleWork(), null);

    seedStream("transcode");
    assert.equal(deferralForRuleWork()?.kind, "streaming");
  });

  it("holds rule work outside the maintenance window", () => {
    setConfig("jobs_maintenance_window", { enabled: true, from: "01:00", to: "06:00" });
    // Midday is outside an overnight window in any zone this resolves to.
    const noon = new Date(2026, 0, 15, 12, 0);
    const verdict = deferralForRuleWork(noon);
    assert.equal(verdict?.kind, "window");

    const threeAm = new Date(2026, 0, 15, 3, 0);
    assert.equal(deferralForRuleWork(threeAm), null);
  });

  it("lets everything through when neither setting is on", () => {
    seedStream("transcode");
    assert.equal(deferralForRuleWork(), null);
  });
});
