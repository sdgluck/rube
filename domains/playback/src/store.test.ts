/**
 * The write half of the watch record — and the one cleanup rules delete on.
 *
 * `diff.test.ts` covers the state machine thoroughly and `aggregates.test.ts`
 * covers the read-side charts, but nothing exercised what happens *between*
 * them: a snapshot arriving, a session closing, and the close being folded into
 * `watch_state`. That is where the numbers `tb.watchedByAll` and
 * `tb.playCount` answer come from, and a cleanup rule with "watched by
 * everyone" deletes files on the strength of them.
 *
 * The properties worth pinning are the ones where being wrong is *plausible*:
 *
 * - A **stale** close must not count as a completed play. Stale means the
 *   poller lost the session, not that anybody finished anything — but its
 *   last-seen offset may well be past the completion threshold, so the naive
 *   test says "completed". Counting it would let a Plex restart mark a library
 *   as watched by everyone, and a `watchedByAll` cleanup rule would then be
 *   entitled to delete it.
 * - `maxCompletionPct` is a high-water mark *including* stale closes, for the
 *   opposite reason: the offset was genuinely reached, and under-reporting it
 *   files the item under "everyone bounced off this".
 * - `isWatchedByAll` over an **empty** user list is false, not vacuously true.
 *   `every()` on an empty array returns true, which would make "watched by
 *   everyone" match the entire library on an install that has synced no users.
 * - `watchStateUserScope` excludes the owner by default. Including them by
 *   accident makes `watchedByAll` far harder to satisfy and the rule silently
 *   matches nothing.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ConfigStoreToken } from "@tinkerbell/core";
import { DbToken, playbackSessions, plexUsers, watchState } from "@tinkerbell/db";
import { PlaybackToken } from "@tinkerbell/domain.playback";
import type { PlexSession } from "@tinkerbell/plex";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const playback = c.resolve(PlaybackToken);

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
    duration: 2 * HOUR,
    viewOffset: 0,
    ...over,
  } as PlexSession;
}

const stateFor = (ratingKey = "100", userId = 7) =>
  db
    .select()
    .from(watchState)
    .where(eq(watchState.ratingKey, ratingKey))
    .all()
    .find((r) => r.userId === userId);

function seedUser(userId: number, username: string, isOwner = false): void {
  db.insert(plexUsers)
    .values({ userId, username, label: `User:${username}`, syncedAt: 0, isOwner: isOwner ? 1 : 0 })
    .run();
}

beforeEach(() => {
  db.delete(watchState).run();
  db.delete(playbackSessions).run();
  db.delete(plexUsers).run();
  setConfig("playback_completion_threshold", 0.9);
  setConfig("playback_retention_days", 0);
  setConfig("watch_state_all_users_include_owner", false);
});

describe("a play, from snapshot to watch state", () => {
  test("an open session is recorded but not yet a play", () => {
    const result = playback.recordPollSnapshot([session()], T0);

    assert.equal(result.opened, 1);
    assert.equal(result.closed, 0);
    assert.equal(stateFor(), undefined, "nothing is counted until the session ends");
  });

  test("a session watched to the end counts as a completed play", () => {
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([session({ viewOffset: 2 * HOUR - MINUTE })], T0 + 2 * HOUR);
    // Gone from the next snapshot: the player stopped.
    const result = playback.recordPollSnapshot([], T0 + 2 * HOUR + MINUTE);

    assert.equal(result.closed, 1);
    assert.equal(result.completed, 1);

    const state = stateFor();
    assert.equal(state?.plays, 1);
    assert.equal(state?.completedPlays, 1);
    assert.ok((state?.maxCompletionPct ?? 0) >= 0.9);
  });

  test("a session abandoned early counts as a play but not a completed one", () => {
    // The distinction cleanup depends on: starting something is not finishing
    // it, and a rule that deletes "watched by everyone" must not fire on a
    // library everyone sampled for five minutes.
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([session({ viewOffset: 5 * MINUTE })], T0 + 5 * MINUTE);
    playback.recordPollSnapshot([], T0 + 6 * MINUTE);

    const state = stateFor();
    assert.equal(state?.plays, 1);
    assert.equal(state?.completedPlays, 0);
  });

  test("the completion threshold is configurable, and is what decides", () => {
    setConfig("playback_completion_threshold", 0.5);

    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([session({ viewOffset: HOUR + MINUTE })], T0 + HOUR);
    playback.recordPollSnapshot([], T0 + HOUR + MINUTE);

    assert.equal(stateFor()?.completedPlays, 1, "just over half was enough at a 0.5 threshold");
  });

  test("a second play accumulates rather than replacing", () => {
    for (const [key, at] of [
      ["s1", T0],
      ["s2", T0 + 3 * HOUR],
    ] as const) {
      playback.recordPollSnapshot([session({ sessionKey: key, viewOffset: 0 })], at);
      playback.recordPollSnapshot([session({ sessionKey: key, viewOffset: 2 * HOUR - MINUTE })], at + 2 * HOUR);
      playback.recordPollSnapshot([], at + 2 * HOUR + MINUTE);
    }

    const state = stateFor();
    assert.equal(state?.plays, 2);
    assert.equal(state?.completedPlays, 2);
    assert.ok((state?.totalWatchedMs ?? 0) > 2 * HOUR, "watched time is summed across plays");
  });

  test("first and last played times bracket the plays", () => {
    playback.recordPollSnapshot([session({ sessionKey: "s1" })], T0);
    playback.recordPollSnapshot([], T0 + MINUTE);
    playback.recordPollSnapshot([session({ sessionKey: "s2" })], T0 + 10 * HOUR);
    playback.recordPollSnapshot([], T0 + 10 * HOUR + MINUTE);

    const state = stateFor();
    assert.ok((state?.firstPlayedAt ?? 0) < (state?.lastPlayedAt ?? 0));
    assert.ok((state?.firstPlayedAt ?? 0) <= T0 + MINUTE);
  });

  test("two users watching the same item keep separate rows", () => {
    // `watchedByAll` is per user; merging them would make one person's finish
    // count for everybody.
    playback.recordPollSnapshot([session({ userId: 7, sessionKey: "a" })], T0);
    playback.recordPollSnapshot([session({ userId: 8, user: "kim", sessionKey: "b" })], T0);
    playback.recordPollSnapshot([], T0 + MINUTE);

    assert.equal(stateFor("100", 7)?.plays, 1);
    assert.equal(stateFor("100", 8)?.plays, 1);
  });

  test("the same user watching two items keeps separate rows", () => {
    playback.recordPollSnapshot([session({ ratingKey: "100", sessionKey: "a" })], T0);
    playback.recordPollSnapshot([session({ ratingKey: "200", sessionKey: "b" })], T0);
    playback.recordPollSnapshot([], T0 + MINUTE);

    assert.equal(stateFor("100")?.plays, 1);
    assert.equal(stateFor("200")?.plays, 1);
  });
});

describe("stale closes", () => {
  test("do not count as a completed play, however far in they got", () => {
    // The failure this prevents: a Plex restart during a full library's worth
    // of playback marks all of it watched, and a `watchedByAll` cleanup rule is
    // then entitled to delete it.
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([session({ viewOffset: 2 * HOUR - MINUTE })], T0 + 2 * HOUR);

    // Nothing closes it; the watchdog does, long after the fact.
    const closed = playback.closeStaleSessions(T0 + 48 * HOUR);
    assert.ok(closed >= 1);

    const state = stateFor();
    assert.equal(state?.plays, 1, "it still happened");
    assert.equal(state?.completedPlays, 0, "but nobody saw it finish");
  });

  test("still raise the high-water mark", () => {
    // The offset was genuinely reached. Under-reporting it would file the item
    // under "everyone bounced off this", which is the opposite error.
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([session({ viewOffset: 2 * HOUR - MINUTE })], T0 + 2 * HOUR);
    playback.closeStaleSessions(T0 + 48 * HOUR);

    assert.ok((stateFor()?.maxCompletionPct ?? 0) >= 0.9);
  });

  test("a session still being seen is not stale", () => {
    playback.recordPollSnapshot([session()], T0);
    assert.equal(playback.closeStaleSessions(T0 + MINUTE), 0);
  });
});

describe("isWatchedByAll", () => {
  beforeEach(() => {
    // Two users, both finished item 100; only one finished item 200.
    for (const [userId, ratingKey, completedPlays] of [
      [7, "100", 1],
      [8, "100", 1],
      [7, "200", 1],
      [8, "200", 0],
    ] as const) {
      db.insert(watchState)
        .values({ ratingKey, userId, plays: 1, completedPlays, totalWatchedMs: 0, maxCompletionPct: 0 })
        .run();
    }
  });

  test("is true when every named user has a completed play", () => {
    assert.equal(playback.isWatchedByAll("100", [7, 8]), true);
  });

  test("is false when one of them has only started it", () => {
    assert.equal(playback.isWatchedByAll("200", [7, 8]), false);
  });

  test("is false for a user with no row at all", () => {
    assert.equal(playback.isWatchedByAll("100", [7, 8, 9]), false);
  });

  test("an EMPTY user list is false, not vacuously true", () => {
    // `[].every(...)` is `true`. Returning that would make "watched by
    // everyone" match every item in the library on an install that has not
    // synced any users — and a cleanup rule would then delete all of it.
    assert.equal(playback.isWatchedByAll("100", []), false);
  });

  test("an unknown item is false", () => {
    assert.equal(playback.isWatchedByAll("nope", [7]), false);
  });

  test("a single user is enough when they have finished it", () => {
    assert.equal(playback.isWatchedByAll("200", [7]), true);
  });
});

describe("watchStateUserScope", () => {
  beforeEach(() => {
    seedUser(1, "owner", true);
    seedUser(7, "sam");
    seedUser(8, "kim");
  });

  test("excludes the owner by default", () => {
    const scope = playback.watchStateUserScope();
    assert.deepEqual(scope.userIds.sort(), [7, 8]);
    assert.equal(scope.includeOwner, false);
  });

  test("includes the owner when asked", () => {
    setConfig("watch_state_all_users_include_owner", true);
    const scope = playback.watchStateUserScope();
    assert.deepEqual(scope.userIds.sort(), [1, 7, 8]);
    assert.equal(scope.includeOwner, true);
  });

  test("reports usernames so a rule's run log can name who `everyone` was", () => {
    // A rule that deletes has to make its definition of "everyone" visible.
    assert.deepEqual(playback.watchStateUserScope().usernames.sort(), ["kim", "sam"]);
  });

  test("an install with no synced users yields an empty scope", () => {
    // Not an error, but the caller has to notice: an empty scope makes
    // `isWatchedByAll` false for everything, which is safe here only because
    // the empty-list case above returns false.
    db.delete(plexUsers).run();
    const scope = playback.watchStateUserScope();
    assert.deepEqual(scope.userIds, []);
    assert.equal(playback.isWatchedByAll("100", scope.userIds), false);
  });
});

describe("rebuildWatchState", () => {
  test("reproduces the same counts from the session log", () => {
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([session({ viewOffset: 2 * HOUR - MINUTE })], T0 + 2 * HOUR);
    playback.recordPollSnapshot([], T0 + 2 * HOUR + MINUTE);
    const before = stateFor();

    playback.rebuildWatchState();

    assert.equal(stateFor()?.plays, before?.plays);
    assert.equal(stateFor()?.completedPlays, before?.completedPlays);
  });

  test("is idempotent — running it twice does not double the counts", () => {
    // It is a repair tool, run by hand when something looks wrong. One that
    // doubled the numbers each time would make the situation worse.
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([], T0 + MINUTE);

    playback.rebuildWatchState();
    const once = stateFor()?.plays;
    playback.rebuildWatchState();

    assert.equal(stateFor()?.plays, once);
  });

  test("repairs a watch_state that has drifted from the log", () => {
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0);
    playback.recordPollSnapshot([], T0 + MINUTE);

    db.update(watchState).set({ plays: 999, completedPlays: 999 }).run();
    playback.rebuildWatchState();

    assert.equal(stateFor()?.plays, 1);
    assert.equal(stateFor()?.completedPlays, 0);
  });
});

describe("pruneOldSessions", () => {
  function seedClosedSession(id: string, startedAt: number): void {
    db.insert(playbackSessions)
      .values({
        id,
        userId: 7,
        username: "sam",
        ratingKey: "100",
        title: "The Matrix",
        type: "movie",
        startedAt,
        lastSeenAt: startedAt + HOUR,
        endedAt: startedAt + HOUR,
      })
      .run();
  }

  test("does nothing when retention is off", () => {
    // 0 is the default and means "keep for ever". Treating it as "keep for zero
    // days" would delete the entire history on first run.
    seedClosedSession("old", T0 - 400 * 24 * HOUR);
    assert.equal(playback.pruneOldSessions(T0), 0);
    assert.equal(db.select().from(playbackSessions).all().length, 1);
  });

  test("removes sessions older than the retention window", () => {
    setConfig("playback_retention_days", 30);
    seedClosedSession("old", T0 - 40 * 24 * HOUR);
    seedClosedSession("recent", T0 - 10 * 24 * HOUR);

    assert.equal(playback.pruneOldSessions(T0), 1);
    assert.deepEqual(
      db
        .select()
        .from(playbackSessions)
        .all()
        .map((r) => r.id),
      ["recent"],
    );
  });

  test("never removes a session that is still open", () => {
    // An open session has no `endedAt`. Deleting one would leave the poller
    // believing nothing is playing and open a duplicate on the next tick.
    setConfig("playback_retention_days", 1);
    playback.recordPollSnapshot([session()], T0 - 40 * 24 * HOUR);

    assert.equal(playback.pruneOldSessions(T0), 0);
    assert.equal(db.select().from(playbackSessions).all().length, 1);
  });

  test("does not touch watch_state — the counts outlive the log", () => {
    // The sessions are the raw log; `watch_state` is the answer derived from
    // them. Pruning the log must not reset what people have watched.
    setConfig("playback_retention_days", 30);
    playback.recordPollSnapshot([session({ viewOffset: 0 })], T0 - 40 * 24 * HOUR);
    playback.recordPollSnapshot([], T0 - 40 * 24 * HOUR + MINUTE);
    const before = stateFor()?.plays;

    playback.pruneOldSessions(T0);

    assert.equal(stateFor()?.plays, before);
  });
});
