import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, MINUTE_MS, SECOND_MS } from "./time.ts";

/**
 * `formatDuration`'s output is embedded verbatim in `job.completed` event
 * messages that users read in the activity feed, so its shape is part of the
 * data, not just presentation. These cases pin it.
 *
 * `domains/events` parses the format back out of those messages
 * (`parseDurationMs`) to average durations across rolled-up rows. The
 * round-trip between the two is pinned in `domains/events/src/duration.test.ts`
 * — this file pins the output shape, that one pins the pair.
 */
describe("formatDuration", () => {
  it("renders sub-minute durations in whole seconds", () => {
    assert.equal(formatDuration(0), "0s");
    assert.equal(formatDuration(999), "0s");
    assert.equal(formatDuration(SECOND_MS), "1s");
    assert.equal(formatDuration(42 * SECOND_MS), "42s");
    assert.equal(formatDuration(59 * SECOND_MS + 999), "59s");
  });

  it("switches to minutes and seconds at one minute", () => {
    assert.equal(formatDuration(MINUTE_MS), "1m 0s");
    assert.equal(formatDuration(3 * MINUTE_MS + 7 * SECOND_MS), "3m 7s");
    assert.equal(formatDuration(90 * MINUTE_MS), "90m 0s");
  });

  it("does not roll minutes into hours", () => {
    // Deliberate, and load-bearing: `parseDurationMs` in `domains/events` has
    // no hours branch, so an "4h 0m 0s" format would silently stop parsing and
    // every rolled-up duration in the activity feed would vanish.
    assert.equal(formatDuration(4 * 60 * MINUTE_MS), "240m 0s");
  });
});
