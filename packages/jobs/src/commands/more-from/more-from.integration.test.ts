/**
 * More From… end to end: a mock Plex and a mock TMDb over real HTTP, the
 * library index and watch ledger seeded locally, the clock pinned.
 *
 * What's protected: each person gets rows for the directors and lead actors
 * whose films they keep finishing — holding the films of theirs they haven't
 * seen — never for a cameo, never for someone with nothing left, and the rows
 * follow as their favourites change.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, personalRowTitle, type JobContext } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, mediaItems, plexUsers, tmdbCache, userPreferences, watchState } from "@rube/db";
import { ClockToken } from "@rube/ports";
import { startMockTmdb, type MockTmdb } from "@rube/test-support/tmdb";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createMoreFromCommand, MORE_FROM_LABEL } from "./index.ts";
import { createMoreFromRemoveCommand } from "../more-from-remove.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");

const c = createTestContainer({ now: NOW });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run: remove } = createMoreFromRemoveCommand(services);

const VILLENEUVE = { id: 137427, name: "Denis Villeneuve" };
const GOSLING = { id: 30614, name: "Ryan Gosling" };
const NOLAN = { id: 525, name: "Christopher Nolan" };
const CAMEO = { id: 9, name: "Character Actor" };

/** Rating key, TMDb id, title, year, director, cast in billing order. */
const FILMS = [
  { key: "100", tmdb: 1, title: "Arrival", year: 2016, director: VILLENEUVE, cast: [] },
  { key: "101", tmdb: 2, title: "Blade Runner 2049", year: 2017, director: VILLENEUVE, cast: [GOSLING] },
  { key: "102", tmdb: 3, title: "Sicario", year: 2015, director: VILLENEUVE, cast: [] },
  { key: "103", tmdb: 4, title: "Prisoners", year: 2013, director: VILLENEUVE, cast: [] },
  { key: "104", tmdb: 5, title: "Enemy", year: 2013, director: VILLENEUVE, cast: [] },
  { key: "110", tmdb: 10, title: "Drive", year: 2011, director: { id: 1, name: "Refn" }, cast: [GOSLING] },
  { key: "111", tmdb: 11, title: "La La Land", year: 2016, director: { id: 2, name: "Chazelle" }, cast: [GOSLING] },
  { key: "112", tmdb: 12, title: "The Nice Guys", year: 2016, director: { id: 3, name: "Black" }, cast: [GOSLING] },
  { key: "113", tmdb: 13, title: "Half Nelson", year: 2006, director: { id: 4, name: "Fleck" }, cast: [GOSLING] },
  { key: "120", tmdb: 20, title: "Memento", year: 2000, director: NOLAN, cast: [] },
  { key: "121", tmdb: 21, title: "Inception", year: 2010, director: NOLAN, cast: [] },
  { key: "122", tmdb: 22, title: "Dunkirk", year: 2017, director: NOLAN, cast: [] },
];
// Fourth-billed in two films Alice saw: not a lead.
const CAMEO_FILMS = [1, 2];

let plex: MockPlex;
let tmdb: MockTmdb;
let run: ReturnType<typeof createMoreFromCommand>["run"];

function testContext(): { ctx: JobContext; log: string[] } {
  const log: string[] = [];
  return {
    log,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => log.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

const rowsOf = (username: string) =>
  [...plex.collections.values()].filter((r) => r.labels.includes(`User:${username}`));
const rowFor = (username: string, personId: number) =>
  rowsOf(username).find((r) => r.labels.includes(`Person:${personId}`));

/** `userId` finished the film with rating key `key`, `daysAgo`. */
function watched(key: string, daysAgo: number, userId = 10): void {
  db.insert(watchState)
    .values({
      ratingKey: key,
      userId,
      plays: 1,
      completedPlays: 1,
      lastPlayedAt: NOW - daysAgo * DAY,
      maxCompletionPct: 1,
    })
    .run();
}

before(async () => {
  plex = await startMockPlex({
    sections: [{ key: "1", title: "Films", type: "movie" }],
    items: FILMS.map((f) => ({ ratingKey: f.key, title: f.title, sectionId: "1", guids: [], labels: [] })),
  });
  tmdb = await startMockTmdb({
    movies: FILMS.map((f) => ({
      id: f.tmdb,
      title: f.title,
      releaseDate: `${f.year}-01-01`,
      directors: [f.director],
      cast: [...f.cast, { id: 90, name: "A" }, { id: 91, name: "B" }, ...(CAMEO_FILMS.includes(f.tmdb) ? [CAMEO] : [])],
    })),
    people: [
      { id: VILLENEUVE.id, name: VILLENEUVE.name, directed: [1, 2, 3, 4, 5] },
      { id: GOSLING.id, name: GOSLING.name, actedIn: [2, 10, 11, 12, 13] },
      { id: NOLAN.id, name: NOLAN.name, directed: [20, 21, 22] },
      { id: CAMEO.id, name: CAMEO.name, actedIn: [1, 2, 10, 11, 12] },
    ],
  });
  run = createMoreFromCommand(services, { now: c.resolve(ClockToken), tmdbBaseUrl: tmdb.origin }).run;
});
after(async () => {
  await plex?.close();
  await tmdb?.close();
});

beforeEach(() => {
  c.setNow(NOW);
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  tmdb.journal.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("global_tmdb_api_key", "tmdb-key");
  for (const table of [plexUsers, mediaItems, watchState, userPreferences, tmdbCache]) db.delete(table).run();
  db.insert(plexUsers)
    .values([
      { userId: 10, username: "alice", label: "alice", syncedAt: 0 },
      { userId: 11, username: "bob", label: "bob", syncedAt: 0 },
    ])
    .run();
  db.insert(mediaItems)
    .values(
      FILMS.map((f) => ({
        ratingKey: f.key,
        sectionId: "1",
        sectionTitle: "Films",
        title: f.title,
        year: f.year,
        type: "movie",
        tmdbId: f.tmdb,
        syncedAt: 0,
      })),
    )
    .run();
  // Alice: two Villeneuves and two Goslings (one shared), and one Nolan.
  watched("100", 10); // Arrival
  watched("101", 5); // Blade Runner 2049 — Villeneuve and Gosling
  watched("110", 20); // Drive — Gosling
  watched("120", 30); // Memento — Nolan, once
});

describe("more-from", () => {
  it("builds a row for each of their top names, of that person's films they haven't seen", async () => {
    const { ctx, log } = testContext();
    await run(ctx, {});

    assert.equal(rowsOf("alice").length, 2);
    assert.equal(rowsOf("bob").length, 0, "Bob has watched nothing");
    const villeneuve = rowFor("alice", VILLENEUVE.id)!;
    assert.equal(villeneuve.title, personalRowTitle("More from Denis Villeneuve", "alice"));
    assert.equal(displayTitle(villeneuve.title), "More from Denis Villeneuve");
    assert.deepEqual(villeneuve.labels, [MORE_FROM_LABEL, `Person:${VILLENEUVE.id}`, "User:alice"]);
    assert.deepEqual(
      villeneuve.memberKeys,
      ["102", "104", "103"],
      "newest first: Sicario, then Enemy and Prisoners by title",
    );
    assert.equal(
      villeneuve.summary,
      "Denis Villeneuve: you've seen 2 of the films they directed. Here are the rest in the library.",
    );
    assert.deepEqual(rowFor("alice", GOSLING.id)!.memberKeys, ["111", "112", "113"]);
    assert.equal(rowFor("alice", CAMEO.id), undefined, "fourth billing is not a lead");
    assert.equal(rowFor("alice", NOLAN.id), undefined, "one Nolan isn't enough to count");
    assert.match(log.join("\n"), /alice: Denis Villeneuve \(2 seen\), Ryan Gosling \(2 seen\)/);
  });

  it("fetches each filmography once, however many people share the name", async () => {
    for (const key of ["100", "101", "110"]) watched(key, 3, 11);
    await run(testContext().ctx, {});
    assert.equal(rowsOf("bob").length, 2);
    assert.equal(tmdb.journal.filter((p) => p === `/person/${VILLENEUVE.id}/movie_credits`).length, 1);
  });

  it("skips a name with nothing left, edits rows in place, and swaps rows as favourites change", async () => {
    await run(testContext().ctx, { people: 1, minItems: 2 });
    const [first] = rowsOf("alice");
    assert.ok(first.labels.includes(`Person:${VILLENEUVE.id}`));

    // She watches the rest of Villeneuve: nothing left, so the next name takes the slot.
    for (const key of ["102", "103", "104"]) watched(key, 1);
    await run(testContext().ctx, { people: 1, minItems: 2 });
    const [second, ...more] = rowsOf("alice");
    assert.equal(more.length, 0);
    assert.ok(second.labels.includes(`Person:${GOSLING.id}`), "Gosling now");
    assert.equal(rowFor("alice", VILLENEUVE.id), undefined, "the Villeneuve row went");

    watched("111", 0);
    await run(testContext().ctx, { people: 1, minItems: 2 });
    const [third] = rowsOf("alice");
    assert.equal(third.ratingKey, second.ratingKey, "edited in place");
    assert.deepEqual(third.memberKeys, ["112", "113"], "The Nice Guys and Half Nelson left");
  });

  it("directors only, when actors are switched off", async () => {
    await run(testContext().ctx, { includeActors: false });
    assert.deepEqual(
      rowsOf("alice").map((r) => displayTitle(r.title)),
      ["More from Denis Villeneuve"],
    );
  });

  it("Not for me drops that one name, and the next one down takes its place", async () => {
    // A third name in reach: a second Nolan for Alice.
    watched("121", 40);
    await run(testContext().ctx, {});
    assert.ok(rowFor("alice", GOSLING.id));
    db.insert(userPreferences)
      .values({
        userId: 10,
        preferences: { excludedCollections: ["More from Ryan Gosling"] },
        optedIn: 1,
        updatedAt: NOW,
      })
      .run();
    const { ctx, log } = testContext();
    await run(ctx, { minItems: 1 });
    assert.equal(rowFor("alice", GOSLING.id), undefined, "Gosling declined");
    assert.ok(rowFor("alice", VILLENEUVE.id), "Villeneuve stays");
    assert.ok(rowFor("alice", NOLAN.id), "Nolan takes the slot");
    assert.match(log.join("\n"), /alice said it wasn't for them/);

    db.delete(userPreferences).run();
    await run(testContext().ctx, {});
  });

  it("is torn down by its remove job, which leaves other rows alone", async () => {
    await run(testContext().ctx, {});
    plex.collections.set("9999", {
      ratingKey: "9999",
      title: "Other",
      sectionId: "1",
      labels: ["PickItBackUp"],
      memberKeys: [],
    });
    await remove(testContext().ctx);
    assert.deepEqual(
      [...plex.collections.values()].map((r) => r.ratingKey),
      ["9999"],
    );
  });
});
