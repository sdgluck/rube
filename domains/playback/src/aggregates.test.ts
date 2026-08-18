/**
 * The aggregates behind the Stats dashboard panels.
 *
 * Three things here are easy to get wrong in a way that looks fine on screen:
 * the hour buckets (SQLite's `%` goes negative for anything before today's
 * midnight, which would silently index off the front of the array), the naming
 * fallbacks in `topUsers` (a removed account still has history), and whether
 * `playbackBreakdown` keeps the rows that recorded no decision — dropping those
 * would shrink the denominator and report a transcoding server as a direct-play
 * one.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb();

const { db, playbackSessions, plexUsers } = await import("@tinkerbell/db");
const { playbackBreakdown, playsByHour, topUsers } = await import("./store.ts");

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A fixed "now": mid-afternoon, so today's bucket is genuinely partial. */
const NOW = new Date(2026, 6, 15, 15, 30).getTime();
const MIDNIGHT = new Date(NOW).setHours(0, 0, 0, 0);

let seq = 0;
function play(
  startedAt: number,
  extra: Partial<{
    userId: number;
    username: string;
    watchedMs: number;
    player: string;
    platform: string;
    decision: string;
    local: number;
  }> = {},
): void {
  seq++;
  db.insert(playbackSessions)
    .values({
      id: `s${seq}`,
      userId: extra.userId ?? 1,
      username: extra.username ?? "someone",
      ratingKey: "100",
      title: "The Matrix",
      type: "movie",
      startedAt,
      lastSeenAt: startedAt,
      watchedMs: extra.watchedMs ?? 0,
      player: extra.player ?? "",
      platform: extra.platform ?? "",
      decision: extra.decision ?? "",
      local: extra.local ?? 0,
    })
    .run();
}

beforeEach(() => {
  db.delete(playbackSessions).run();
  db.delete(plexUsers).run();
});

describe("playsByHour", () => {
  it("always returns 24 buckets, zeroed when there is nothing", () => {
    assert.equal(playsByHour({ now: NOW }).length, 24);
    assert.deepEqual(
      playsByHour({ now: NOW }).filter((n) => n !== 0),
      [],
    );
  });

  it("buckets by hour of the local day", () => {
    play(MIDNIGHT); // 00:xx
    play(MIDNIGHT + 9 * HOUR + 59 * 60_000); // 09:59
    play(MIDNIGHT + 10 * HOUR); // 10:00
    const hours = playsByHour({ now: NOW });
    assert.equal(hours[0], 1);
    assert.equal(hours[9], 1);
    assert.equal(hours[10], 1);
  });

  it("folds earlier days onto the same hour rather than off the front", () => {
    // The regression this exists for: a negative remainder from SQLite's `%`
    // would put yesterday's 21:00 in no bucket at all.
    play(MIDNIGHT + 21 * HOUR); // today, 21:00
    play(MIDNIGHT - DAY + 21 * HOUR); // yesterday, 21:00
    play(MIDNIGHT - 30 * DAY + 21 * HOUR); // a month ago, 21:00
    const hours = playsByHour({ now: NOW });
    assert.equal(hours[21], 3);
    assert.equal(
      hours.reduce((sum, n) => sum + n, 0),
      3,
      "every play lands in exactly one bucket",
    );
  });

  it("honours the since cutoff", () => {
    play(MIDNIGHT + 3 * HOUR);
    play(MIDNIGHT - 10 * DAY + 3 * HOUR);
    assert.equal(playsByHour({ now: NOW, since: MIDNIGHT - DAY })[3], 1);
  });
});

describe("topUsers", () => {
  it("ranks by plays and sums watch time", () => {
    play(NOW, { userId: 1, watchedMs: 1000 });
    play(NOW, { userId: 1, watchedMs: 2000 });
    play(NOW, { userId: 2, watchedMs: 9000 });
    const rows = topUsers();
    assert.deepEqual(
      rows.map((r) => [r.userId, r.plays, r.watchedMs]),
      [
        [1, 2, 3000],
        [2, 1, 9000],
      ],
      "two plays outrank one, however long the one was",
    );
  });

  it("prefers the account's name, then its username, then the name on the play", () => {
    db.insert(plexUsers).values({ userId: 1, username: "sam_p", name: "Sam", label: "", syncedAt: NOW }).run();
    db.insert(plexUsers).values({ userId: 2, username: "jo_p", name: null, label: "", syncedAt: NOW }).run();
    play(NOW, { userId: 1, username: "stale" });
    play(NOW, { userId: 2, username: "stale" });
    // No `plex_users` row at all — an account removed since it watched.
    play(NOW, { userId: 3, username: "departed" });
    const names = new Map(topUsers().map((r) => [r.userId, r.name]));
    assert.equal(names.get(1), "Sam");
    assert.equal(names.get(2), "jo_p");
    assert.equal(names.get(3), "departed");
  });

  it("names the unknown-user sentinel rather than calling it User 0", () => {
    play(NOW, { userId: 0, username: "" });
    assert.equal(topUsers()[0].name, "Unknown");
  });

  it("honours the limit", () => {
    for (let i = 1; i <= 5; i++) play(NOW, { userId: i });
    assert.equal(topUsers({ limit: 3 }).length, 3);
  });
});

describe("playbackBreakdown", () => {
  it("counts each dimension over the same rows", () => {
    play(NOW, { platform: "Apple TV", player: "Living Room", decision: "transcode", local: 0 });
    play(NOW, { platform: "Apple TV", player: "Bedroom", decision: "directplay", local: 1 });
    play(NOW, { platform: "Chrome", player: "Laptop", decision: "directplay", local: 1 });

    const result = playbackBreakdown();
    assert.equal(result.total, 3);
    assert.deepEqual(result.platforms, [
      { value: "Apple TV", count: 2 },
      { value: "Chrome", count: 1 },
    ]);
    assert.deepEqual(result.decisions, [
      { value: "directplay", count: 2 },
      { value: "transcode", count: 1 },
    ]);
    assert.deepEqual(result.locations, [
      { value: "local", count: 2 },
      { value: "remote", count: 1 },
    ]);
    assert.equal(result.players.length, 3);
  });

  it("keeps rows that recorded no decision instead of dropping them", () => {
    // Backfilled history: real plays, no playback facts. Dropping them would
    // report this server as 100% transcoding when it is 50%.
    play(NOW, { decision: "transcode" });
    play(NOW, { decision: "" });
    const result = playbackBreakdown();
    assert.equal(result.total, 2);
    assert.deepEqual(
      result.decisions.find((d) => d.value === ""),
      { value: "", count: 1 },
    );
  });

  it("honours the since cutoff", () => {
    play(NOW, { platform: "Apple TV" });
    play(NOW - 10 * DAY, { platform: "Chrome" });
    const result = playbackBreakdown({ since: NOW - DAY });
    assert.equal(result.total, 1);
    assert.deepEqual(result.platforms, [{ value: "Apple TV", count: 1 }]);
  });
});
