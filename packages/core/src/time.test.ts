import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, MINUTE_MS, SECOND_MS } from "./time.ts";

/**
 * `formatDuration`'s output is embedded verbatim in `job.completed` event
 * messages that users read in the activity feed, so its shape is part of the
 * data, not just presentation. These cases pin it.
 *
 * (The plan for this work referenced a `parseDurationMs` in `domains/events`
 * that would need to round-trip against this. No such function exists in the
 * tree — nothing parses these strings back — so pinning the format is the
 * whole obligation.)
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
    // Deliberate: a four-hour job reads as "240m 0s". Changing this would
    // change strings already written into the events table.
    assert.equal(formatDuration(4 * 60 * MINUTE_MS), "240m 0s");
  });
});
