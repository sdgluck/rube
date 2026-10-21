/**
 * Finish the Franchise end to end: a mock Plex and a mock TMDb over real HTTP,
 * the library index and watch ledger seeded locally, and the clock pinned.
 *
 * What's protected: each person's row holds the next film in the series they
 * are partway through — by their own history, from the library they have —
 * and follows them as they watch, emptying away when there is nothing next.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, personalRowTitle, type JobContext } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { arrMovies, DbToken, mediaItems, plexUsers, tmdbCache, userPreferences, watchState } from "@rube/db";
import { ClockToken } from "@rube/ports";
import { eq } from "drizzle-orm";
import { startMockTmdb, type MockTmdb } from "@rube/test-support/tmdb";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createFinishTheFranchiseCommand, FRANCHISE_LABEL } from "./index.ts";
import { createFranchiseRemoveCommand } from "../franchise-remove.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");

const c = createTestContainer({ now: NOW });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run: remove } = createFranchiseRemoveCommand(services);

/** Rating key, TMDb id, title, release date, series. */
const FILMS = [
  { key: "100", tmdb: 348, title: "Alien", date: "1979-05-25", series: 8091 },
  { key: "101", tmdb: 679, title: "Aliens", date: "1986-07-18", series: 8091 },
  { key: "102", tmdb: 8077, title: "Alien 3", date: "1992-05-22", series: 8091 },
  { key: "103", tmdb: 8078, title: "Alien Resurrection", date: "1997-11-26", series: 8091 },
  { key: "200", tmdb: 862, title: "Toy Story", date: "1995-11-22", series: 10194 },
  { key: "201", tmdb: 863, title: "Toy Story 2", date: "1999-11-24", series: 10194 },
  { key: "300", tmdb: 550, title: "Fight Club", date: "1999-10-15" },
];

let plex: MockPlex;
let tmdb: MockTmdb;
let run: ReturnType<typeof createFinishTheFranchiseCommand>["run"];

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

/** Alice (10) watched `key`, `daysAgo`, this far through. */
function watched(key: string, daysAgo: number, completion = 1, userId = 10): void {
  db.insert(watchState)
    .values({
      ratingKey: key,
      userId,
      plays: 1,
      completedPlays: completion >= 0.9 ? 1 : 0,
      lastPlayedAt: NOW - daysAgo * DAY,
      maxCompletionPct: completion,
    })
    .onConflictDoUpdate({
      target: [watchState.ratingKey, watchState.userId],
      set: {
        completedPlays: completion >= 0.9 ? 1 : 0,
        maxCompletionPct: completion,
        lastPlayedAt: NOW - daysAgo * DAY,
      },
    })
    .run();
}

before(async () => {
  plex = await startMockPlex({
    sections: [
      { key: "1", title: "Films", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ],
    items: FILMS.map((f) => ({
      ratingKey: f.key,
      title: f.title,
      sectionId: "1",
      guids: [`tmdb://${f.tmdb}`],
      labels: [],
    })),
  });
  tmdb = await startMockTmdb({
    movies: FILMS.map((f) => ({ id: f.tmdb, title: f.title, releaseDate: f.date, collectionId: f.series })),
    collections: [
      { id: 8091, name: "Alien Collection", partIds: [348, 679, 8077, 8078] },
      { id: 10194, name: "Toy Story Collection", partIds: [862, 863, 10193] },
    ],
  });
  // A part the library doesn't have, and isn't out yet.
  tmdb.movies.set(10193, { id: 10193, title: "Toy Story 5", releaseDate: "2026-12-01", collectionId: 10194 });
  run = createFinishTheFranchiseCommand(services, { now: c.resolve(ClockToken), tmdbBaseUrl: tmdb.origin }).run;
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
  for (const table of [plexUsers, mediaItems, watchState, userPreferences, tmdbCache, arrMovies])
    db.delete(table).run();
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
        type: "movie",
        tmdbId: f.tmdb,
        syncedAt: 0,
      })),
    )
    .run();
  // Alice: the first two Aliens a week ago, Toy Story yesterday.
  watched("100", 8);
  watched("101", 7);
  watched("200", 1);
});

describe("finish-the-franchise", () => {
  it("builds each person's row of the next film in every series they've started, most recent first", async () => {
    const { ctx, log } = testContext();
    await run(ctx, {});

    const [row, ...others] = rowsOf("alice");
    assert.equal(others.length, 0);
    assert.equal(rowsOf("bob").length, 0, "Bob has watched nothing");
    assert.equal(row.title, personalRowTitle("Finish the Franchise", "alice"));
    assert.equal(displayTitle(row.title), "Finish the Franchise");
    assert.deepEqual(row.labels, [FRANCHISE_LABEL, "User:alice"]);
    assert.deepEqual(row.memberKeys, ["201", "102"], "Toy Story 2 (yesterday's series), then Alien 3");
    assert.equal(row.summary, "The next film in series you've started. Next up: Toy Story 2 and Alien 3.");
    assert.deepEqual(plex.journal.pinHomes, [
      { ratingKey: row.ratingKey, own: false, shared: true, recommended: false },
    ]);
    assert.match(log.join("\n"), /Alien Collection: next Alien 3/);
  });

  it("moves on as they watch, editing the row in place", async () => {
    await run(testContext().ctx, {});
    const [first] = rowsOf("alice");
    watched("102", 0);
    await run(testContext().ctx, {});
    const [second] = rowsOf("alice");
    assert.equal(second.ratingKey, first.ratingKey);
    assert.deepEqual([...second.memberKeys].sort(), ["103", "201"]);
    assert.equal(plex.journal.pinned.length, 1, "pinned once, on creation");
  });

  it("offers nothing past a gap in the library, unless told to skip it", async () => {
    db.delete(mediaItems).run();
    db.insert(mediaItems)
      .values(
        FILMS.filter((f) => f.key !== "102").map((f) => ({
          ratingKey: f.key,
          sectionId: "1",
          sectionTitle: "Films",
          title: f.title,
          type: "movie",
          tmdbId: f.tmdb,
          syncedAt: 0,
        })),
      )
      .run();
    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.deepEqual(rowsOf("alice")[0].memberKeys, ["201"]);
    assert.match(log.join("\n"), /next is Alien 3, which isn't in the library/);

    await run(testContext().ctx, { skipMissing: true });
    assert.deepEqual([...rowsOf("alice")[0].memberKeys].sort(), ["103", "201"]);
  });

  it("leaves out a series nobody has touched for longer than the window, and an unreleased next part", async () => {
    watched("201", 0); // Toy Story 2 seen: next is Toy Story 5, not out until December
    await run(testContext().ctx, { maxIdleDays: 30 });
    assert.deepEqual(rowsOf("alice")[0].memberKeys, ["102"]);

    c.setNow(NOW + 60 * DAY); // Alien last played 67 days ago; Toy Story 5 is out but not in the library
    await run(testContext().ctx, { maxIdleDays: 30 });
    assert.equal(rowsOf("alice").length, 0, "removed when there's nothing next");
  });

  it("counts a film cleanup has since deleted, by Radarr's record of it", async () => {
    db.delete(mediaItems).where(eq(mediaItems.ratingKey, "101")).run();
    db.insert(arrMovies)
      .values({ instanceId: "radarr", arrId: 1, tmdbId: 679, title: "Aliens", plexRatingKey: "101", syncedAt: 0 })
      .run();
    await run(testContext().ctx, {});
    assert.ok(rowsOf("alice")[0].memberKeys.includes("102"), "still Alien 3, not Aliens again");
  });

  it("refetches details cached before franchises were, and nothing fresh", async () => {
    db.insert(tmdbCache)
      .values([
        { id: "movie:348", tmdbId: 348, mediaType: "movie", data: { keywords: [] }, fetchedAt: Date.now() },
        { id: "movie:679", tmdbId: 679, mediaType: "movie", data: { collectionId: 8091 }, fetchedAt: Date.now() },
        { id: "movie:862", tmdbId: 862, mediaType: "movie", data: { collectionId: 10194 }, fetchedAt: Date.now() },
      ])
      .run();
    await run(testContext().ctx, {});
    assert.deepEqual(
      tmdb.journal.filter((p) => p.startsWith("/movie/")),
      ["/movie/348"],
    );
    assert.deepEqual(rowsOf("alice")[0].memberKeys, ["201", "102"]);
  });

  it("takes the row away when the person said it wasn't for them", async () => {
    await run(testContext().ctx, {});
    db.insert(userPreferences)
      .values({
        userId: 10,
        preferences: { excludedCollections: ["Finish the Franchise"] },
        optedIn: 1,
        updatedAt: NOW,
      })
      .run();
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);
  });

  it("sweeps the row of someone who is no longer a user, and the teardown removes only its own", async () => {
    await run(testContext().ctx, {});
    db.delete(plexUsers).run();
    db.insert(plexUsers).values({ userId: 11, username: "bob", label: "bob", syncedAt: 0 }).run();
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);

    db.delete(plexUsers).run();
    db.insert(plexUsers).values({ userId: 10, username: "alice", label: "alice", syncedAt: 0 }).run();
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
