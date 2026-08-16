import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, isWithinClockWindow, parseClock, MINUTE_MS, SECOND_MS } from "./time.ts";

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

/**
 * Quiet hours suppress notifications, so the two ways to get this wrong are
 * bad in opposite directions: a window that fails open pages someone at 3am,
 * and one that fails closed silences the server indefinitely. The overnight
 * shape is the common one and the one a naive `start <= now < end` gets wrong.
 */
describe("isWithinClockWindow", () => {
  const at = (hh: number, mm = 0) => new Date(2027, 0, 15, hh, mm);

  it("covers an ordinary daytime window", () => {
    assert.equal(isWithinClockWindow("09:00", "17:00", at(12)), true);
    assert.equal(isWithinClockWindow("09:00", "17:00", at(8)), false);
    assert.equal(isWithinClockWindow("09:00", "17:00", at(17)), false);
  });

  it("spans midnight when the end precedes the start", () => {
    assert.equal(isWithinClockWindow("23:00", "07:00", at(23, 30)), true);
    assert.equal(isWithinClockWindow("23:00", "07:00", at(2)), true);
    assert.equal(isWithinClockWindow("23:00", "07:00", at(6, 59)), true);
    assert.equal(isWithinClockWindow("23:00", "07:00", at(7)), false);
    assert.equal(isWithinClockWindow("23:00", "07:00", at(12)), false);
  });

  it("is inclusive of the start and exclusive of the end", () => {
    assert.equal(isWithinClockWindow("23:00", "07:00", at(23)), true);
  });

  it("treats an unparseable or empty window as no window", () => {
    // Failing closed here would let a typo silence every notification.
    assert.equal(isWithinClockWindow("nonsense", "07:00", at(2)), false);
    assert.equal(isWithinClockWindow("", "", at(2)), false);
    assert.equal(isWithinClockWindow("07:00", "07:00", at(7)), false);
  });

  it("reads the clock in the given zone, not the server's", () => {
    // 03:00 UTC is the middle of the night in London and midday in Tokyo, so
    // an overnight quiet window must include one and exclude the other.
    const utcEarlyMorning = new Date(Date.UTC(2027, 0, 15, 3, 0));
    assert.equal(isWithinClockWindow("23:00", "07:00", utcEarlyMorning, "UTC"), true);
    assert.equal(isWithinClockWindow("23:00", "07:00", utcEarlyMorning, "Asia/Tokyo"), false);
  });
});

describe("parseClock", () => {
  it("accepts a 24-hour time and rejects anything else", () => {
    assert.equal(parseClock("07:30"), 450);
    assert.equal(parseClock("00:00"), 0);
    assert.equal(parseClock("23:59"), 1439);
    assert.equal(parseClock("24:00"), null);
    assert.equal(parseClock("7:5"), null);
    assert.equal(parseClock(""), null);
  });
});
