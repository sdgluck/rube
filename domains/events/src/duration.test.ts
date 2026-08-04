/**
 * The round trip the hardening plan asked for.
 *
 * `formatDuration` (in `@tinkerbell/core`) writes a duration into the tail of a
 * `job.completed` event message; `parseDurationMs` (here) reads it back out so
 * `rollupConsecutiveEvents` can average durations across collapsed rows. The
 * two are a serialisation pair that live in different packages with nothing but
 * a regex between them, which is exactly the kind of coupling that rots
 * silently — a "cosmetic" tweak to the format would just make every rolled-up
 * duration quietly disappear.
 *
 * This test is the link. It is why `formatDuration` deliberately does not roll
 * minutes into hours: `parseDurationMs`'s pattern has no hours branch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, MINUTE_MS, SECOND_MS } from "@tinkerbell/core";
import { parseDurationMs } from "./index.ts";

/** Whole seconds only — `formatDuration` truncates sub-second precision. */
const CASES = [
  0,
  SECOND_MS,
  42 * SECOND_MS,
  59 * SECOND_MS,
  MINUTE_MS,
  MINUTE_MS + SECOND_MS,
  3 * MINUTE_MS + 7 * SECOND_MS,
  59 * MINUTE_MS + 59 * SECOND_MS,
  90 * MINUTE_MS,
  4 * 60 * MINUTE_MS, // 4h — "240m 0s", the case that would break under an hours branch
];

describe("formatDuration → parseDurationMs", () => {
  it("round-trips every duration we actually emit", () => {
    for (const ms of CASES) {
      const formatted = formatDuration(ms);
      assert.equal(parseDurationMs(formatted), ms, `round trip failed for ${ms}ms ("${formatted}")`);
    }
  });

  it("round-trips from inside a real event message", () => {
    // This is the actual shape written by CommandJob and runInternalJob.
    const message = `Generate Collections completed in ${formatDuration(3 * MINUTE_MS + 7 * SECOND_MS)}`;
    assert.equal(parseDurationMs(message), 3 * MINUTE_MS + 7 * SECOND_MS);
  });

  it("truncates sub-second input, and says so", () => {
    // Not a round trip: the formatter floors to whole seconds, so 1500ms comes
    // back as 1000ms. Pinned because it's the one lossy edge.
    assert.equal(formatDuration(1500), "1s");
    assert.equal(parseDurationMs("1s"), SECOND_MS);
  });

  it("only matches a duration at the very end of the message", () => {
    // End-anchored on purpose: a duration-shaped number in the middle of a
    // sentence is not this event's duration.
    assert.equal(parseDurationMs("Retried 3s into a 5s window and gave up"), null);
    assert.equal(parseDurationMs("Sync Media failed: connection reset"), null);
    // …but one at the end is, which is where every real message puts it.
    assert.equal(parseDurationMs("Retried, then gave up after 5s"), 5 * SECOND_MS);
  });
});
