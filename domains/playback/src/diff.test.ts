import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PlexSession } from "@rube/plex";
import { diffSnapshot, playKey, staleCloses, type OpenSession } from "./diff.ts";

const INTERVAL = 30_000;
const OPTS = { completionThreshold: 0.85, intervalMs: INTERVAL };

/** A `/status/sessions` entry with only the fields the state machine reads. */
function session(over: Partial<PlexSession> = {}): PlexSession {
  return {
    ratingKey: "100",
    sessionKey: "s1",
    title: "The Matrix",
    type: "movie",
    user: "sam",
    userId: 7,
    player: "Apple TV",
    state: "playing",
    decision: "directplay",
    duration: 3_600_000,
    viewOffset: 0,
    ...over,
  };
}

/** An open row as the poller left it on the previous tick. */
function open(over: Partial<OpenSession> = {}): OpenSession {
  return {
    id: "row-1",
    plexSessionKey: "s1",
    userId: 7,
    ratingKey: "100",
    startedAt: 0,
    lastSeenAt: 0,
    durationMs: 3_600_000,
    watchedMs: 0,
    viewOffsetMs: 0,
    state: "playing",
    ...over,
  };
}

describe("diffSnapshot — opening and closing", () => {
  test("an unseen session opens exactly one row", () => {
    const diff = diffSnapshot([], [session()], 1000, OPTS);
    assert.equal(diff.opens.length, 1);
    assert.equal(diff.updates.length, 0);
    assert.equal(diff.closes.length, 0);
    assert.equal(diff.opens[0].ratingKey, "100");
    assert.equal(diff.opens[0].userId, 7);
  });

  test("first sighting credits no watch time", () => {
    // Joining a session already 90 minutes in must not bank 90 minutes.
    const diff = diffSnapshot([], [session({ viewOffset: 5_400_000 })], 1000, OPTS);
    assert.equal(diff.opens[0].watchedMs, 0);
    assert.equal(diff.opens[0].viewOffsetMs, 5_400_000);
  });

  test("appear → progress → disappear yields one closed row with the right watchedMs", () => {
    const first = diffSnapshot([], [session({ viewOffset: 0 })], 0, OPTS);
    assert.equal(first.opens.length, 1);

    const afterOne = diffSnapshot(
      [open({ lastSeenAt: 0, viewOffsetMs: 0 })],
      [session({ viewOffset: 30_000 })],
      INTERVAL,
      OPTS,
    );
    assert.equal(afterOne.updates.length, 1);
    assert.equal(afterOne.updates[0].watchedMs, 30_000);

    const afterTwo = diffSnapshot(
      [open({ lastSeenAt: INTERVAL, viewOffsetMs: 30_000, watchedMs: 30_000 })],
      [session({ viewOffset: 60_000 })],
      INTERVAL * 2,
      OPTS,
    );
    assert.equal(afterTwo.updates[0].watchedMs, 60_000);

    const closed = diffSnapshot(
      [open({ lastSeenAt: INTERVAL * 2, viewOffsetMs: 60_000, watchedMs: 60_000 })],
      [],
      INTERVAL * 3,
      OPTS,
    );
    assert.equal(closed.closes.length, 1);
    assert.equal(closed.closes[0].watchedMs, 60_000);
  });

  test("a session with no rating key is ignored rather than recorded against nothing", () => {
    const diff = diffSnapshot([], [session({ ratingKey: undefined })], 1000, OPTS);
    assert.equal(diff.opens.length, 0);
  });
});

describe("diffSnapshot — watch time accounting", () => {
  test("a seek backwards does not reduce watchedMs", () => {
    const diff = diffSnapshot(
      [open({ lastSeenAt: 0, viewOffsetMs: 600_000, watchedMs: 600_000 })],
      [session({ viewOffset: 60_000 })],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.updates[0].watchedMs, 600_000);
    // The offset itself still tracks where the user actually is.
    assert.equal(diff.updates[0].viewOffsetMs, 60_000);
  });

  test("a seek forwards credits only the elapsed wall-clock, not the jump", () => {
    // Skipping 40 minutes ahead between two 30s ticks is not 40 minutes watched.
    const diff = diffSnapshot(
      [open({ lastSeenAt: 0, viewOffsetMs: 0, watchedMs: 0 })],
      [session({ viewOffset: 2_400_000 })],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.updates[0].watchedMs, INTERVAL);
  });

  test("pausing accrues no watch time", () => {
    // Same offset on consecutive ticks is what a pause looks like.
    const diff = diffSnapshot(
      [open({ lastSeenAt: 0, viewOffsetMs: 300_000, watchedMs: 300_000 })],
      [session({ viewOffset: 300_000, state: "paused" })],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.updates[0].watchedMs, 300_000);
    assert.equal(diff.updates[0].state, "paused");
  });

  test("a late tick credits real progress rather than treating it as a seek", () => {
    // A slow host delivers the next sample 80s later with 80s of progress.
    const diff = diffSnapshot(
      [open({ lastSeenAt: 0, viewOffsetMs: 0, watchedMs: 0 })],
      [session({ viewOffset: 80_000 })],
      80_000,
      OPTS,
    );
    assert.equal(diff.updates[0].watchedMs, 80_000);
  });
});

describe("diffSnapshot — session identity", () => {
  test("a reused sessionKey on a different item opens a new row", () => {
    // Plex recycles session keys; extending the old row would weld two plays
    // into one with a nonsense duration.
    const diff = diffSnapshot(
      [open({ ratingKey: "100", plexSessionKey: "s1" })],
      [session({ ratingKey: "200", sessionKey: "s1", title: "Heat" })],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.opens.length, 1);
    assert.equal(diff.opens[0].ratingKey, "200");
    assert.equal(diff.closes.length, 1, "the old play closes rather than lingering");
  });

  test("the same item played by two users is two rows", () => {
    const diff = diffSnapshot(
      [],
      [session({ userId: 7, sessionKey: "s1" }), session({ userId: 9, sessionKey: "s2", user: "alex" })],
      1000,
      OPTS,
    );
    assert.equal(diff.opens.length, 2);
  });

  test("playKey distinguishes on all three components", () => {
    assert.notEqual(playKey("s1", "100", 7), playKey("s1", "200", 7));
    assert.notEqual(playKey("s1", "100", 7), playKey("s1", "100", 9));
    assert.notEqual(playKey("s1", "100", 7), playKey("s2", "100", 7));
  });
});

describe("diffSnapshot — completion", () => {
  test("crossing the threshold marks the close completed", () => {
    const diff = diffSnapshot(
      [open({ viewOffsetMs: 3_300_000, durationMs: 3_600_000 })], // ~92%
      [],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.closes[0].state, "completed");
  });

  test("stopping below the threshold marks it abandoned", () => {
    const diff = diffSnapshot(
      [open({ viewOffsetMs: 600_000, durationMs: 3_600_000 })], // ~17%
      [],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.closes[0].state, "abandoned");
  });

  test("exactly at the threshold counts as completed", () => {
    const diff = diffSnapshot([open({ viewOffsetMs: 3_060_000, durationMs: 3_600_000 })], [], INTERVAL, OPTS);
    assert.equal(diff.closes[0].completionPct, 0.85);
    assert.equal(diff.closes[0].state, "completed");
  });

  test("a zero duration yields 0% rather than dividing by zero", () => {
    const diff = diffSnapshot([open({ viewOffsetMs: 60_000, durationMs: 0 })], [], INTERVAL, OPTS);
    assert.equal(diff.closes[0].completionPct, 0);
    assert.equal(diff.closes[0].state, "abandoned");
  });

  test("a duration that arrives late is adopted rather than discarded", () => {
    // A starting transcode reports duration 0 on the first tick.
    const diff = diffSnapshot(
      [open({ durationMs: 0, viewOffsetMs: 0 })],
      [session({ duration: 3_600_000, viewOffset: 30_000 })],
      INTERVAL,
      OPTS,
    );
    assert.equal(diff.updates[0].durationMs, 3_600_000);
  });
});

describe("staleCloses", () => {
  test("rows older than the cutoff close as stale, not completed", () => {
    // 96% watched, but we lost track — we do not get to claim it finished.
    const closes = staleCloses(
      [open({ lastSeenAt: 0, viewOffsetMs: 3_500_000, durationMs: 3_600_000 })],
      INTERVAL * 10,
      INTERVAL * 3,
    );
    assert.equal(closes.length, 1);
    assert.equal(closes[0].state, "stale");
  });

  test("a row seen recently is left open", () => {
    const closes = staleCloses([open({ lastSeenAt: INTERVAL * 9 })], INTERVAL * 10, INTERVAL * 3);
    assert.equal(closes.length, 0);
  });

  test("the close is stamped at last sighting, not now", () => {
    // Otherwise a week-long outage records a week-long play.
    const closes = staleCloses([open({ lastSeenAt: 5_000 })], 5_000 + INTERVAL * 100, INTERVAL * 3);
    assert.equal(closes[0].endedAt, 5_000);
  });
});
