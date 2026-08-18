/**
 * Day bucketing for the sparkline series.
 *
 * The whole risk here is an off-by-one at a boundary: a series that is one day
 * short, or one that drops today's plays into yesterday's bucket. Neither
 * throws, and both look entirely plausible in a 44px graph — so the boundaries
 * are asserted rather than eyeballed.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { playbackSessions } from "@tinkerbell/db";
import { StatsToken } from "@tinkerbell/domain.stats";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { getActivitySeries } = c.resolve(StatsToken);

const DAY = 86_400_000;
/** A fixed "now": mid-afternoon, so today's bucket is genuinely partial. */
const NOW = new Date(2026, 6, 15, 15, 30).getTime();
const MIDNIGHT = new Date(NOW).setHours(0, 0, 0, 0);

let seq = 0;
function play(startedAt: number): void {
  seq++;
  db.insert(playbackSessions)
    .values({
      id: `s${seq}`,
      userId: 1,
      username: "someone",
      ratingKey: "100",
      title: "The Matrix",
      type: "movie",
      startedAt,
      lastSeenAt: startedAt,
    })
    .run();
}

beforeEach(() => {
  db.delete(playbackSessions).run();
});

describe("getActivitySeries", () => {
  it("returns one entry per day asked for", () => {
    assert.equal(getActivitySeries(14, NOW).length, 14);
    assert.equal(getActivitySeries(7, NOW).length, 7);
  });

  it("counts nothing as zeroes rather than an empty series", () => {
    assert.deepEqual(getActivitySeries(3, NOW), [0, 0, 0]);
  });

  it("puts today in the last bucket", () => {
    play(NOW);
    play(MIDNIGHT); // the first instant of today
    assert.deepEqual(getActivitySeries(3, NOW), [0, 0, 2]);
  });

  it("puts the instant before midnight in yesterday", () => {
    play(MIDNIGHT - 1);
    assert.deepEqual(getActivitySeries(3, NOW), [0, 1, 0]);
  });

  it("includes the first instant of the window and excludes the one before it", () => {
    const windowStart = MIDNIGHT - 2 * DAY;
    play(windowStart);
    play(windowStart - 1);
    assert.deepEqual(getActivitySeries(3, NOW), [1, 0, 0]);
  });

  it("counts each day independently", () => {
    play(MIDNIGHT - 2 * DAY + 60_000);
    play(MIDNIGHT - DAY + 60_000);
    play(MIDNIGHT - DAY + 120_000);
    play(NOW);
    assert.deepEqual(getActivitySeries(3, NOW), [1, 2, 1]);
  });
});
