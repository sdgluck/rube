/**
 * The window maths decides whether a rule runs at all, and gets it wrong in
 * two directions that both look like something else: a rule silently skipped
 * all year reads as a broken rule, and a Christmas window read as empty reads
 * as a rule that never worked.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { describeRuleWindow, isRuleActiveOn, runsInNightlyBatch } from "./rule-schedule.ts";

/** A local date, so the assertions don't depend on the runner's timezone. */
const on = (month: number, day: number) => new Date(2026, month - 1, day, 12, 0, 0);

test("isRuleActiveOn", async (t) => {
  await t.test("a rule with no schedule is always active", () => {
    assert.equal(isRuleActiveOn(undefined, on(3, 15)), true);
    assert.equal(isRuleActiveOn({}, on(3, 15)), true);
  });

  await t.test("a one-day window is read in the given zone", () => {
    // 01:00 UTC on 1 November is still Halloween in Los Angeles. A rule whose
    // season is a single day used to flip on the container's clock, so it was
    // out of season for the hours its owner actually watches films.
    const halloween = { activeFrom: "10-31", activeTo: "10-31" };
    const utcAfterMidnight = new Date(Date.UTC(2027, 10, 1, 1, 0));
    assert.equal(isRuleActiveOn(halloween, utcAfterMidnight, "UTC"), false);
    assert.equal(isRuleActiveOn(halloween, utcAfterMidnight, "America/Los_Angeles"), true);
  });

  await t.test("a rule with only a cron is always active", () => {
    assert.equal(isRuleActiveOn({ cron: "0 3 * * *" }, on(3, 15)), true);
  });

  await t.test("inside a normal window", () => {
    const october = { activeFrom: "10-01", activeTo: "11-05" };
    assert.equal(isRuleActiveOn(october, on(10, 15)), true);
    assert.equal(isRuleActiveOn(october, on(9, 30)), false);
    assert.equal(isRuleActiveOn(october, on(11, 6)), false);
  });

  await t.test("both ends are inclusive", () => {
    const october = { activeFrom: "10-01", activeTo: "11-05" };
    assert.equal(isRuleActiveOn(october, on(10, 1)), true);
    assert.equal(isRuleActiveOn(october, on(11, 5)), true);
  });

  await t.test("a single-day window is that day, not an empty range", () => {
    const halloween = { activeFrom: "10-31", activeTo: "10-31" };
    assert.equal(isRuleActiveOn(halloween, on(10, 31)), true);
    assert.equal(isRuleActiveOn(halloween, on(10, 30)), false);
    assert.equal(isRuleActiveOn(halloween, on(11, 1)), false);
  });

  await t.test("a window that wraps the year end is Christmas, not nothing", () => {
    const christmas = { activeFrom: "12-01", activeTo: "01-05" };
    assert.equal(isRuleActiveOn(christmas, on(12, 25)), true);
    assert.equal(isRuleActiveOn(christmas, on(1, 3)), true);
    assert.equal(isRuleActiveOn(christmas, on(1, 6)), false);
    assert.equal(isRuleActiveOn(christmas, on(6, 1)), false);
  });

  await t.test("a half-specified window is ignored rather than guessed at", () => {
    assert.equal(isRuleActiveOn({ activeFrom: "10-01" }, on(3, 1)), true);
    assert.equal(isRuleActiveOn({ activeTo: "11-05" }, on(3, 1)), true);
  });
});

test("describeRuleWindow", async (t) => {
  await t.test("reads as a date range", () => {
    assert.equal(describeRuleWindow({ activeFrom: "10-01", activeTo: "11-05" }), "1 October – 5 November");
  });

  await t.test("says nothing when there is no window", () => {
    assert.equal(describeRuleWindow(undefined), null);
    assert.equal(describeRuleWindow({ cron: "0 3 * * *" }), null);
  });
});

test("runsInNightlyBatch", async (t) => {
  await t.test("defaults to yes, including for a rule with its own cron", () => {
    assert.equal(runsInNightlyBatch(undefined), true);
    assert.equal(runsInNightlyBatch({ cron: "0 * * * *" }), true);
  });

  await t.test("a rule with only triggers still runs nightly", () => {
    // Otherwise disabling the source job silently stops the rule forever.
    assert.equal(runsInNightlyBatch({ triggers: ["item-added"] }), true);
  });

  await t.test("opting out is explicit", () => {
    assert.equal(runsInNightlyBatch({ cron: "0 * * * *", excludeFromBatch: true }), false);
  });
});
