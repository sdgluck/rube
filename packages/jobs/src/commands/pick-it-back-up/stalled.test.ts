import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "@tinkerbell/db/test-db";
import { playbackSessions } from "@tinkerbell/db";
import { pickUpPoint, pickUpSummary, stalledShows, type EpisodePlay, type Leaf } from "./stalled.ts";

const DAY = 86_400_000;

function leaves(seasons: number[]): Leaf[] {
  // Deliberately out of order, with a special in season 0.
  const out: Leaf[] = [{ ratingKey: "special", season: 0, episode: 1 }];
  seasons.forEach((count, s) => {
    for (let e = count; e >= 1; e--) out.push({ ratingKey: `s${s + 1}e${e}`, season: s + 1, episode: e });
  });
  return out;
}

const played = (entries: Array<[string, number]>) =>
  new Map<string, EpisodePlay>(entries.map(([k, c]) => [k, { completion: c, finished: c >= 0.8 }]));

describe("pickUpPoint", () => {
  it("is the episode after the furthest one they finished", () => {
    const point = pickUpPoint(
      leaves([3, 3]),
      played([
        ["s1e1", 1],
        ["s1e2", 1],
        ["s1e3", 0.95],
      ]),
    );
    assert.deepEqual(point, {
      next: { ratingKey: "s2e1", season: 2, episode: 1 },
      resume: false,
      remaining: 3,
      finished: 3,
    });
  });

  it("is the episode they stopped partway into, as a resume", () => {
    const point = pickUpPoint(
      leaves([4]),
      played([
        ["s1e1", 1],
        ["s1e2", 1],
        ["s1e3", 0.3],
      ]),
    );
    assert.equal(point?.next.ratingKey, "s1e3");
    assert.equal(point?.resume, true);
    assert.equal(point?.remaining, 2);
  });

  it("goes by the furthest, so an old rewatch of episode 1 doesn't send them back", () => {
    const point = pickUpPoint(
      leaves([5]),
      played([
        ["s1e4", 1],
        ["s1e1", 0.2],
      ]),
    );
    assert.equal(point?.next.ratingKey, "s1e5");
  });

  it("is nowhere when they're caught up, or none of their plays is in the show", () => {
    assert.equal(
      pickUpPoint(
        leaves([2]),
        played([
          ["s1e1", 1],
          ["s1e2", 1],
        ]),
      ),
      null,
    );
    assert.equal(pickUpPoint(leaves([2]), played([["gone", 1]])), null);
  });

  it("ignores specials, which would otherwise be 'next' for everyone", () => {
    assert.equal(pickUpPoint(leaves([2]), played([["special", 1]])), null);
  });
});

describe("pickUpSummary", () => {
  const p = (title: string, season: number, episode: number) => ({
    title,
    point: { next: { ratingKey: "", season, episode }, resume: false, remaining: 1, finished: 2 },
  });
  it("names the first three next episodes", () => {
    assert.equal(
      pickUpSummary([p("Andor", 1, 4), p("The Bear", 2, 1), p("Severance", 1, 9), p("Slow Horses", 3, 2)]),
      "Shows you started and haven't been back to. Next up: Andor S1E4, The Bear S2E1, Severance S1E9 and 1 more.",
    );
    assert.equal(pickUpSummary([p("Andor", 1, 4)]), "Shows you started and haven't been back to. Next up: Andor S1E4.");
    assert.equal(
      pickUpSummary([p("Andor", 1, 4), p("The Bear", 2, 1)]),
      "Shows you started and haven't been back to. Next up: Andor S1E4 and The Bear S2E1.",
    );
  });
});

describe("stalledShows", () => {
  let t: TestDb;
  const now = Date.parse("2026-10-18T12:00:00Z");
  let n = 0;
  function play(show: string, episode: string, daysAgo: number, completion: number, extra = {}) {
    t.db
      .insert(playbackSessions)
      .values({
        id: `s${n++}`,
        userId: 10,
        username: "alice",
        ratingKey: episode,
        grandparentRatingKey: show,
        title: episode,
        type: "episode",
        startedAt: now - daysAgo * DAY,
        lastSeenAt: now,
        completionPct: completion,
        ...extra,
      })
      .run();
  }
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.dispose());

  it("keeps shows last played inside the window, most recently stopped first", () => {
    play("recent", "r1", 3, 1); // still watching
    play("stopped", "s1", 20, 1);
    play("stopped", "s2", 18, 0.5);
    play("older", "o1", 100, 1);
    play("abandoned", "a1", 500, 1); // given up
    const shows = stalledShows(t.db, [10], now, { stallDays: 14, maxStallDays: 365 });
    assert.deepEqual(
      shows.map((s) => s.showKey),
      ["stopped", "older"],
    );
    assert.deepEqual(shows[0].plays.get("s2"), { completion: 0.5, finished: false });
  });

  it("counts an imported play as finished, though it carries no completion", () => {
    play("imported", "i1", 30, 0, { source: "plex-history" });
    const [show] = stalledShows(t.db, [10], now, { stallDays: 14, maxStallDays: 365 });
    assert.equal(show.plays.get("i1")?.finished, true);
  });

  it("leaves out other people's plays and films", () => {
    play("theirs", "t1", 30, 1, { userId: 11 });
    t.db
      .insert(playbackSessions)
      .values({
        id: "film",
        userId: 10,
        username: "alice",
        ratingKey: "f",
        title: "f",
        type: "movie",
        startedAt: now - 30 * DAY,
        lastSeenAt: now,
      })
      .run();
    assert.deepEqual(stalledShows(t.db, [10], now, { stallDays: 14, maxStallDays: 365 }), []);
  });
});
