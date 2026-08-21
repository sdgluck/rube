/**
 * The degradation judgement. Two of these cases are the bugs that made the
 * measurement meaningless: direct play could never fail, and a single transient
 * API error always did.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assessStep, type StepMeasurement } from "./assess.ts";

/** A healthy step: three good samples, sessions all visible, bytes flowing. */
function healthy(over: Partial<StepMeasurement> = {}): StepMeasurement {
  return {
    apiErrors: 0,
    sampleCount: 3,
    sessionsSeen: 4,
    expectedSessions: 4,
    sessionsEverMatched: true,
    avgSpeed: 2.4,
    streamOk: 12,
    streamErrors: 0,
    bytesRead: 4_000_000,
    streamEverFlowed: true,
    windowMs: 21_000,
    dutyCycleMs: 4_000,
    ...over,
  };
}

describe("assessStep", () => {
  test("a healthy step is not degraded", () => {
    assert.deepEqual(assessStep(healthy()), { degraded: false, reason: null });
  });

  test("transcode speed below realtime is degradation", () => {
    const r = assessStep(healthy({ avgSpeed: 0.8 }));
    assert.equal(r.degraded, true);
    assert.match(r.reason!, /0\.80x is below realtime/);
  });

  test("speed at exactly realtime is still healthy", () => {
    assert.equal(assessStep(healthy({ avgSpeed: 1.0 })).degraded, false);
  });

  test("one transient sampling error does not end the run", () => {
    // The old rule was `errors > 0`, so a single 502 was reported as the
    // server's capacity limit.
    assert.equal(assessStep(healthy({ apiErrors: 1 })).degraded, false);
  });

  test("most samples failing does end the run, and says why", () => {
    const r = assessStep(healthy({ apiErrors: 2 }));
    assert.equal(r.degraded, true);
    assert.match(r.reason!, /stopped answering \(2\/3/);
  });

  describe("direct play, where there is no transcode speed to read", () => {
    // `avgSpeed: null` is the permanent state of a direct-play run. Every
    // assertion below would have passed as "healthy" before, which is why a
    // direct-play test always returned the configured cap.
    const directPlay = (over: Partial<StepMeasurement>) => assessStep(healthy({ avgSpeed: null, ...over }));

    test("a healthy direct-play step is still healthy", () => {
      assert.equal(directPlay({}).degraded, false);
    });

    test("most stream requests failing is degradation", () => {
      const r = directPlay({ streamOk: 2, streamErrors: 9 });
      assert.equal(r.degraded, true);
      assert.match(r.reason!, /9 of 11 stream requests failed/);
    });

    test("an occasional failed segment is tolerated", () => {
      assert.equal(directPlay({ streamOk: 12, streamErrors: 2 }).degraded, false);
    });

    test("no traffic at all in the window is a stall", () => {
      const r = directPlay({ streamOk: 0, streamErrors: 0, bytesRead: 0 });
      assert.equal(r.degraded, true);
      assert.match(r.reason!, /stalled/);
    });

    test("a slow read that transferred bytes is not a stall", () => {
      assert.equal(directPlay({ streamOk: 0, streamErrors: 0, bytesRead: 512 }).degraded, false);
    });

    test("a window shorter than one poll cycle cannot prove a stall", () => {
      // The confirmation re-measure is a short window by design; concluding
      // "stalled" from it would report a healthy server as saturated.
      const r = directPlay({ streamOk: 0, streamErrors: 0, bytesRead: 0, windowMs: 500, dutyCycleMs: 4_000 });
      assert.equal(r.degraded, false);
    });

    test("a first read that has not landed yet is startup, not a stall", () => {
      // Otherwise step one fails on any client whose opening request is still
      // in flight when the window closes.
      const r = directPlay({ streamOk: 0, streamErrors: 0, bytesRead: 0, streamEverFlowed: false });
      assert.equal(r.degraded, false);
    });
  });

  test("sessions Plex stops reporting are degradation", () => {
    const r = assessStep(healthy({ sessionsSeen: 3, expectedSessions: 5 }));
    assert.equal(r.degraded, true);
    assert.match(r.reason!, /2 of 5 session\(s\) dropped out/);
  });

  test("a server that never reported our sessions is not treated as dropping them", () => {
    // Otherwise step one of a setup whose sessions simply don't appear in
    // `/status/sessions` reads as a total dropout.
    assert.equal(
      assessStep(healthy({ sessionsSeen: 0, expectedSessions: 3, sessionsEverMatched: false })).degraded,
      false,
    );
  });

  test("losing the ability to measure outranks what was measured", () => {
    const r = assessStep(healthy({ apiErrors: 3, avgSpeed: 0.2 }));
    assert.match(r.reason!, /stopped answering/);
  });
});
