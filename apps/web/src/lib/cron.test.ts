/**
 * The preview exists to catch expressions that are wrong but valid, so the
 * cases that matter are the ones where cron does something other than what
 * the person typing it expected: a zone that isn't the browser's, an
 * expression that never fires, and several schedules landing on one minute.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { cronNextRuns, findScheduleCollisions, formatFireTime } from "./cron.ts";

test("cronNextRuns", async (t) => {
  await t.test("returns the requested number of fire times, in order", () => {
    const { error, next } = cronNextRuns("0 3 * * *", "UTC", 3);
    assert.equal(error, null);
    assert.equal(next.length, 3);
    assert.ok(next[0].getTime() < next[1].getTime());
    assert.ok(next[1].getTime() < next[2].getTime());
  });

  await t.test("every fire time is 03:00 in the schedule's zone", () => {
    const { next } = cronNextRuns("0 3 * * *", "UTC", 3);
    for (const run of next) assert.equal(run.getUTCHours(), 3);
  });

  await t.test("the zone changes the answer", () => {
    const utc = cronNextRuns("0 3 * * *", "UTC", 1).next[0];
    const tokyo = cronNextRuns("0 3 * * *", "Asia/Tokyo", 1).next[0];
    assert.notEqual(utc.getTime(), tokyo.getTime());
  });

  await t.test("an empty expression is not an error, just nothing", () => {
    assert.deepEqual(cronNextRuns("   "), { error: null, next: [] });
  });

  await t.test("a malformed expression reports the parse failure", () => {
    const { error, next } = cronNextRuns("not a cron");
    assert.ok(error);
    assert.equal(next.length, 0);
  });

  await t.test("an expression that can never fire yields no runs", () => {
    // 30 February.
    const { next } = cronNextRuns("0 0 30 2 *", "UTC", 1);
    assert.equal(next.length, 0);
  });
});

test("formatFireTime renders in the given zone", () => {
  const date = new Date(Date.UTC(2027, 0, 2, 23, 30));
  // 23:30 UTC is the next day in Tokyo, so the two must not agree.
  assert.notEqual(formatFireTime(date, "UTC"), formatFireTime(date, "Asia/Tokyo"));
});

test("findScheduleCollisions", async (t) => {
  const minute = 60_000;

  await t.test("groups jobs sharing a minute", () => {
    const collisions = findScheduleCollisions([
      { name: "Generate", nextRun: 10 * minute },
      { name: "Cleanup", nextRun: 10 * minute + 5_000 },
      { name: "Posters", nextRun: 40 * minute },
    ]);
    assert.deepEqual(collisions, [["Generate", "Cleanup"]]);
  });

  await t.test("says nothing when every job has its own minute", () => {
    const collisions = findScheduleCollisions([
      { name: "Generate", nextRun: 10 * minute },
      { name: "Cleanup", nextRun: 11 * minute },
    ]);
    assert.deepEqual(collisions, []);
  });
});
