import { describe, test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "@tinkerbell/db/test-db";
import { matchRooms, mediaItems, plexSections, plexUsers } from "@tinkerbell/db";
import { DAY_MS } from "@tinkerbell/core";
import { createMatch, MATCH_ROOM_RETENTION_MS, MatchError, ONLINE_WINDOW_MS, type ServerUser } from "./index.ts";

const testDb = createTestDb("tinkerbell-match-test-");
after(testDb.dispose);
const { db } = testDb;

let clock = 1_000_000_000_000;
/** userId → section keys shared with them; absent means every library. */
const shares = new Map<number, string[]>();
const match = createMatch({
  db,
  now: () => clock,
  sharing: { sharedSectionKeys: (userId) => shares.get(userId) ?? [] },
});

const ALICE: ServerUser = { userId: 1, username: "alice" };
const BOB: ServerUser = { userId: 2, username: "bob" };
const CAROL: ServerUser = { userId: 3, username: "carol" };

function film(ratingKey: string, sectionId: string, extra: Partial<typeof mediaItems.$inferInsert> = {}) {
  db.insert(mediaItems)
    .values({
      ratingKey,
      sectionId,
      sectionTitle: sectionId === "1" ? "Films" : "Kids",
      title: `Film ${ratingKey}`,
      type: "movie",
      thumb: `/library/metadata/${ratingKey}/thumb/1`,
      syncedAt: clock,
      ...extra,
    })
    .run();
}

beforeEach(() => {
  db.delete(matchRooms).run();
  db.delete(mediaItems).run();
  db.delete(plexSections).run();
  db.delete(plexUsers).run();
  shares.clear();
  for (const [key, title] of [
    ["1", "Films"],
    ["2", "Kids"],
  ]) {
    db.insert(plexSections).values({ key, title, type: "movie", syncedAt: clock }).run();
  }
  db.insert(plexSections).values({ key: "3", title: "TV", type: "show", syncedAt: clock }).run();
  for (const u of [ALICE, BOB, CAROL]) {
    db.insert(plexUsers).values({ userId: u.userId, username: u.username, label: u.username, syncedAt: clock }).run();
  }
  for (let i = 1; i <= 30; i++) film(`f${i}`, "1", { genres: i % 2 ? ["Drama"] : ["Comedy"], year: 1980 + i });
  film("k1", "2");
});

function code(e: unknown): string | undefined {
  return e instanceof MatchError ? e.code : undefined;
}

describe("libraries", () => {
  test("only movie libraries shared with the caller, and only ones with films", () => {
    shares.set(BOB.userId, ["2"]);
    assert.deepEqual(
      match.libraries(ALICE.userId).map((l) => l.title),
      ["Films", "Kids"],
    );
    assert.deepEqual(
      match.libraries(BOB.userId).map((l) => [l.title, l.count]),
      [["Kids", 1]],
    );
  });

  test("a room can't be made in a library that isn't shared with you", () => {
    shares.set(BOB.userId, ["2"]);
    assert.throws(
      () => match.createRoom(BOB, "1", {}),
      (e) => code(e) === "FORBIDDEN",
    );
  });

  test("filters: a film the mirror knows nothing about passes a bound", () => {
    film("unknown", "1");
    // 30 seeded films have years 1981–2010; the one with no year passes too.
    assert.equal(match.count(ALICE.userId, "1", { minYear: 2001 }), 10 + 1);
    assert.equal(match.count(ALICE.userId, "1", { genres: ["Drama"] }), 15);
  });
});

describe("the deck", () => {
  test("everyone in a room gets the same order, and it differs between rooms", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    const a = match.deck(ALICE, room, [], 30).films.map((f) => f.ratingKey);
    const b = match.deck(BOB, room, [], 30).films.map((f) => f.ratingKey);
    assert.deepEqual(a, b);
    const other = match.createRoom(ALICE, "1", {}).code;
    assert.notDeepEqual(
      match.deck(ALICE, other, [], 30).films.map((f) => f.ratingKey),
      a,
    );
  });

  test("pages by what you don't have yet, so swiping between pages skips nothing", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    const first = match.deck(ALICE, room, [], 5).films.map((f) => f.ratingKey);
    // Swipe three of the five; the portal still holds the other two.
    for (const key of first.slice(0, 3)) match.swipe(ALICE, room, key, false);
    const next = match.deck(ALICE, room, first.slice(3), 5);
    const all = match.deck(ALICE, room, [], 30).films.map((f) => f.ratingKey);
    assert.deepEqual(
      next.films.map((f) => f.ratingKey),
      all.slice(2, 7),
    );
    assert.equal(next.remaining, 30 - 3 - 2);
  });

  test("a film outside the room can't be swiped", () => {
    const { code: room } = match.createRoom(ALICE, "1", { genres: ["Drama"] });
    assert.throws(
      () => match.swipe(ALICE, room, "f2", true),
      (e) => code(e) === "BAD_REQUEST",
    );
    assert.throws(
      () => match.swipe(ALICE, room, "k1", true),
      (e) => code(e) === "BAD_REQUEST",
    );
  });

  test("posters are signed, and a forged signature is refused", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    const poster = match.deck(ALICE, room, [], 1).films[0]!.poster!;
    const url = new URL(poster, "http://portal");
    const key = decodeURIComponent(url.pathname.split("/").pop()!);
    assert.equal(match.posterThumb(key, url.searchParams.get("sig")), `/library/metadata/${key}/thumb/1`);
    assert.equal(match.posterThumb("f1", url.searchParams.get("sig") === "x" ? "y" : "x"), null);
    assert.equal(match.posterThumb(key === "f1" ? "f2" : "f1", url.searchParams.get("sig")), null);
  });
});

describe("matches", () => {
  test("a film everyone in the room liked is unanimous; one more than one liked is partial", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    match.join(CAROL, room);
    assert.deepEqual(match.swipe(ALICE, room, "f1", true), { matched: false });
    assert.deepEqual(match.swipe(BOB, room, "f1", true), { matched: false });
    assert.deepEqual(match.swipe(CAROL, room, "f1", true), { matched: true });
    match.swipe(ALICE, room, "f2", true);
    match.swipe(BOB, room, "f2", true);
    match.swipe(CAROL, room, "f3", true);

    const state = match.state(ALICE, room);
    assert.deepEqual(
      state.matches.map((m) => [m.ratingKey, m.unanimous, m.likedBy]),
      [
        ["f1", true, ["alice", "bob", "carol"]],
        ["f2", false, ["alice", "bob"]],
      ],
    );
    assert.equal(state.unanimousCount, 1);
    assert.equal(state.swipedCount, 3);
  });

  test("leaving takes your likes with you, and a film can match without you", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    match.join(CAROL, room);
    match.swipe(ALICE, room, "f1", true);
    match.swipe(BOB, room, "f1", true);
    match.leave(CAROL, room);
    assert.equal(match.state(ALICE, room).matches[0]?.unanimous, true);
    assert.throws(
      () => match.state(CAROL, room),
      (e) => code(e) === "FORBIDDEN",
    );
  });

  test("the last one out closes the room", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.leave(ALICE, room);
    assert.throws(
      () => match.join(ALICE, room),
      (e) => code(e) === "NOT_FOUND",
    );
  });

  test("undo and start over touch only your own swipes", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    match.swipe(ALICE, room, "f1", true);
    match.swipe(BOB, room, "f1", true);
    match.undo(ALICE, room, "f1");
    assert.equal(match.state(BOB, room).matches.length, 0);
    match.swipe(ALICE, room, "f1", true);
    match.reset(BOB, room);
    assert.deepEqual(match.state(ALICE, room).me, { name: "alice", guest: false, swiped: 1, liked: 1 });
    assert.equal(match.state(BOB, room).me.swiped, 0);
  });

  test("votes: one per member, and withdrawable", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    match.vote(ALICE, room, "f1");
    match.vote(BOB, room, "f1");
    match.vote(ALICE, room, "f2");
    assert.deepEqual(match.state(ALICE, room).votes, [
      { ratingKey: "f2", voters: ["alice"] },
      { ratingKey: "f1", voters: ["bob"] },
    ]);
    match.vote(ALICE, room, null);
    assert.equal(match.state(ALICE, room).myVote, null);
  });

  test("presence comes from the poll", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    clock += ONLINE_WINDOW_MS + 1;
    assert.deepEqual(
      match.state(ALICE, room).members.map((m) => [m.name, m.online]),
      [
        ["alice", true],
        ["bob", false],
      ],
    );
    match.state(BOB, room);
    assert.equal(match.state(ALICE, room).members[1]?.online, true);
  });
});

describe("who gets in", () => {
  test("the bare code admits a server user only to a library they can already see", () => {
    shares.set(BOB.userId, ["2"]);
    const { code: room, invite } = match.createRoom(ALICE, "1", {});
    assert.throws(
      () => match.join(BOB, room),
      (e) => code(e) === "FORBIDDEN",
    );
    // The invite link is the creator's say-so.
    match.join(BOB, room, invite);
    assert.equal(match.deck(BOB, room, [], 1).films.length, 1);
  });

  test("a guest needs the invite, and gets a token for that room alone", () => {
    const { code: room, invite } = match.createRoom(ALICE, "1", {});
    const other = match.createRoom(ALICE, "1", {});
    assert.throws(
      () => match.joinAsGuest(room, "wrong", "Dee"),
      (e) => code(e) === "NOT_FOUND",
    );
    assert.throws(
      () => match.preview(room, other.invite),
      (e) => code(e) === "NOT_FOUND",
    );
    assert.deepEqual(match.preview(room, invite).members, ["alice"]);

    const { token } = match.joinAsGuest(room, invite, "  Dee  ");
    const dee = { guestToken: token };
    match.swipe(dee, room, "f1", true);
    match.swipe(ALICE, room, "f1", true);
    const state = match.state(dee, room);
    assert.deepEqual(state.me, { name: "Dee", guest: true, swiped: 1, liked: 1 });
    assert.equal(state.matches[0]?.unanimous, true);

    assert.throws(
      () => match.state(dee, other.code),
      (e) => code(e) === "FORBIDDEN",
    );
    assert.throws(
      () => match.state({ guestToken: "made-up" }, room),
      (e) => code(e) === "FORBIDDEN",
    );

    match.leave(dee, room);
    assert.throws(
      () => match.state(dee, room),
      (e) => code(e) === "FORBIDDEN",
    );
  });

  test("a room closes when its creator loses its library, or leaves the server", () => {
    const { code: room, invite } = match.createRoom(ALICE, "1", {});
    const { token } = match.joinAsGuest(room, invite, "Dee");
    shares.set(ALICE.userId, ["2"]);
    assert.throws(
      () => match.state({ guestToken: token }, room),
      (e) => code(e) === "NOT_FOUND",
    );
    shares.delete(ALICE.userId);
    match.state({ guestToken: token }, room);
    db.delete(plexUsers).where(eq(plexUsers.userId, ALICE.userId)).run();
    assert.throws(
      () => match.state({ guestToken: token }, room),
      (e) => code(e) === "NOT_FOUND",
    );
  });

  test("myRooms lists a server user's live rooms", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    match.join(BOB, room);
    assert.deepEqual(match.myRooms(BOB.userId), [
      { code: room, library: "Films", filters: {}, members: ["alice", "bob"] },
    ]);
  });
});

describe("retention", () => {
  test("an untouched room expires, and the sweep removes it", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    clock += MATCH_ROOM_RETENTION_MS + DAY_MS;
    assert.throws(
      () => match.state(ALICE, room),
      (e) => code(e) === "NOT_FOUND",
    );
    assert.deepEqual(match.myRooms(ALICE.userId), []);
    assert.equal(match.pruneStaleRooms(), 1);
  });

  test("activity keeps a room alive", () => {
    const { code: room } = match.createRoom(ALICE, "1", {});
    clock += MATCH_ROOM_RETENTION_MS - DAY_MS;
    match.swipe(ALICE, room, "f1", true);
    clock += 2 * DAY_MS;
    assert.equal(match.pruneStaleRooms(), 0);
    assert.equal(match.state(ALICE, room).code, room);
  });
});
