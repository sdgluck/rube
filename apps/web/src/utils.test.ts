import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCron } from "./utils.ts";

test("describeCron says the schedules System Tasks actually uses", () => {
  assert.equal(describeCron("*/30 * * * * *"), "Every 30 seconds");
  assert.equal(describeCron("* * * * *"), "Every minute");
  assert.equal(describeCron("*/15 * * * *"), "Every 15 minutes");
  assert.equal(describeCron("0 */6 * * *"), "Every 6 hours");
  assert.equal(describeCron("45 0 * * *"), "Daily at 00:45");
});

test("describeCron says a weekly schedule in words", () => {
  assert.equal(describeCron("0 3 * * 0"), "Sundays at 03:00");
  assert.equal(describeCron("0 3 * * 7"), "Sundays at 03:00");
  assert.equal(describeCron("30 9 * * 1,3"), "Mondays and Wednesdays at 09:30");
  assert.equal(describeCron("0 8 * * 1-5"), "Weekdays at 08:00");
  assert.equal(describeCron("0 10 * * 0,6"), "Weekends at 10:00");
});

test("describeCron says what the schedule builder can say", () => {
  assert.equal(describeCron("0 3 1 * *"), "On the 1st at 03:00");
  assert.equal(describeCron("0 3 * * 2-4"), "Tue, Wed, Thu at 03:00");
  assert.equal(describeCron("0 3 * * 5#L"), "On the last Friday at 03:00");
  // Was "Daily at 2,14:30".
  assert.equal(describeCron("30 2,14 * * *"), "Every day at 02:30 and 14:30");
  // Not "Every 15 minutes": the window and the days are the point.
  assert.equal(describeCron("*/15 9-17 * * 1-5"), "Weekdays every 15 minutes from 09:00 to 17:45");
});

test("describeCron falls back to the expression rather than guessing", () => {
  assert.equal(describeCron("5,35 2,14 * * *"), "5,35 2,14 * * *");
  assert.equal(describeCron("0 3 L * 5"), "0 3 L * 5");
});
