import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  axisTicks,
  blockSegments,
  DAY_MINUTES,
  keyStep,
  moveWeeklyDay,
  pointToMinute,
  pxToMinutes,
  snap,
  WEEK_MINUTES,
  windowSegments,
} from "./timelineMath.ts";

describe("timelineMath", () => {
  it("snaps to the quarter hour and wraps at midnight", () => {
    assert.equal(snap(67), 60);
    assert.equal(snap(68), 75);
    assert.equal(snap(1440 + 20), 15);
    assert.equal(snap(-10), 1425);
    assert.equal(snap(WEEK_MINUTES + 30, 15, WEEK_MINUTES), 30);
  });

  it("turns pixels into minutes on the track", () => {
    assert.equal(pxToMinutes(100, 1440), 100);
    assert.equal(pxToMinutes(50, 720), 100);
    assert.equal(pxToMinutes(10, 0), 0);
    assert.equal(pointToMinute(150, { left: 100, width: 1440 }), 50);
    assert.equal(pointToMinute(0, { left: 100, width: 1440 }), 0);
    assert.equal(pointToMinute(9999, { left: 0, width: 1440 }), DAY_MINUTES);
  });

  it("draws a run past midnight as two segments", () => {
    assert.deepEqual(blockSegments(60, 30), [
      { leftPct: (60 / 1440) * 100, widthPct: (30 / 1440) * 100, continued: false },
    ]);
    const split = blockSegments(1410, 60);
    assert.equal(split.length, 2);
    assert.equal(split[1].leftPct, 0);
    assert.ok(Math.abs(split[1].widthPct - (30 / 1440) * 100) < 1e-9);
    assert.ok(split[1].continued);
  });

  it("moves by a quarter hour, an hour with shift, and a day only in the week view", () => {
    assert.equal(keyStep("ArrowRight", false), 15);
    assert.equal(keyStep("ArrowLeft", true), -60);
    assert.equal(keyStep("ArrowUp", false), null);
    assert.equal(keyStep("ArrowDown", false, WEEK_MINUTES), DAY_MINUTES);
    assert.equal(keyStep("Enter", false), null);
  });

  it("moves one weekly occurrence to another day, merging a collision", () => {
    assert.deepEqual(moveWeeklyDay([1, 3], 3, 5), [1, 5]);
    assert.deepEqual(moveWeeklyDay([1, 3], 3, 1), [1]);
    assert.deepEqual(moveWeeklyDay([0], 0, -1), [6]);
  });

  it("labels the axis in hours for a day and in days for a week", () => {
    assert.equal(axisTicks(DAY_MINUTES, 6).length, 4);
    assert.equal(axisTicks(DAY_MINUTES, 6)[1].label, "06:00");
    assert.deepEqual(
      axisTicks(WEEK_MINUTES, 24).map((t) => t.label),
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    );
  });

  it("draws an overnight window across midnight", () => {
    assert.equal(windowSegments(22 * 60, 6 * 60).length, 2);
    assert.equal(windowSegments(60, 360).length, 1);
    assert.equal(windowSegments(60, 360, WEEK_MINUTES).length, 7);
  });
});
