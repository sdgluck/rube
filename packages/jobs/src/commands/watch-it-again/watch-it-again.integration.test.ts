/**
 * Watch It Again end to end: a mock Plex over HTTP, the library index and the
 * watch ledger seeded locally, and the clock pinned.
 *
 * What's protected: the row holds films the person finished and hasn't
 * played in years — favourites first — and nothing they watched lately, half
 * watched, or saw a copy of last week.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, personalRowTitle, type JobContext } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, mediaItems, plexUsers, userPreferences, watchState } from "@rube/db";
import { ClockToken } from "@rube/ports";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createWatchItAgainCommand, WATCH_AGAIN_LABEL } from "./index.ts";
import { createWatchAgainRemoveCommand } from "../watch-again-remove.ts";
import { pastFavourites, watchAgainSummary } from "./pick.ts";

const DAY = 86_400_000;
const YEAR = 365 * DAY;
const NOW = Date.parse("2026-10-20T12:00:00Z");

const c = createTestContainer({ now: NOW });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createWatchItAgainCommand(services, { now: c.resolve(ClockToken) });
const { run: remove } = createWatchAgainRemoveCommand(services);

/** Rating key, title, TMDb id, rating. 101 and 102 are two copies of one film. */
const FILMS = [
  { key: "100", title: "Heat", tmdb: 949, rating: 8.3 },
  { key: "101", title: "Alien", tmdb: 348, rating: 8.5 },
  { key: "102", title: "Alien", tmdb: 348, rating: 8.5 },
  { key: "103", title: "Arrival", tmdb: 329865, rating: 7.9 },
  { key: "104", title: "Paddington 2", tmdb: 346648, rating: 7.8 },
  { key: "105", title: "Half Watched", tmdb: 1, rating: 9 },
  { key: "106", title: "Recent", tmdb: 2, rating: 9 },
];

let plex: MockPlex;

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

/** Alice (10) played `key`: `completed` full plays, last `yearsAgo`, this far through. */
function played(key: string, yearsAgo: number, completed = 1, pct = 1): void {
  db.insert(watchState)
    .values({
      ratingKey: key,
      userId: 10,
      plays: Math.max(completed, 1),
      completedPlays: completed,
      lastPlayedAt: NOW - yearsAgo * YEAR,
      maxCompletionPct: pct,
    })
    .run();
}

before(async () => {
  plex = await startMockPlex({
    sections: [
      { key: "1", title: "Films", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ],
    items: FILMS.map((f) => ({ ratingKey: f.key, title: f.title, sectionId: "1", guids: [], labels: [] })),
  });
});
after(async () => plex?.close());

beforeEach(() => {
  c.setNow(NOW);
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  for (const table of [plexUsers, mediaItems, watchState, userPreferences]) db.delete(table).run();
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
        rating: f.rating,
        syncedAt: 0,
      })),
    )
    .run();
  played("100", 3, 3); // Heat: three times, three years ago
  played("101", 4); // Alien: once, four years ago (the 1080p)
  played("103", 2.5); // Arrival: once
  played("104", 5, 2); // Paddington 2: twice
  played("105", 4, 0, 0.4); // started, never finished
  played("106", 0.5); // finished, but six months ago
});

describe("watch-it-again", () => {
  it("builds a row of films finished and not played in years, rewatched most first", async () => {
    const { ctx } = testContext();
    await run(ctx, {});

    const [row, ...others] = rowsOf("alice");
    assert.equal(others.length, 0);
    assert.equal(rowsOf("bob").length, 0, "Bob has watched nothing");
    assert.equal(row.title, personalRowTitle("Watch It Again", "alice"));
    assert.equal(displayTitle(row.title), "Watch It Again");
    assert.deepEqual(row.labels, [WATCH_AGAIN_LABEL, "User:alice"]);
    // Heat (3×), Paddington 2 (2×), then once each: Alien (8.5) before Arrival (7.9).
    assert.deepEqual(row.memberKeys, ["100", "104", "101", "103"]);
    assert.equal(row.summary, "Films you loved a while back: Heat, Paddington 2, Alien and 1 more.");
    assert.deepEqual(plex.journal.pinHomes, [
      { ratingKey: row.ratingKey, own: false, shared: true, recommended: false },
    ]);
  });

  it("a rewatch of another copy last week keeps the film out", async () => {
    played("102", 0.02); // the 4K Alien, a week ago
    await run(testContext().ctx, {});
    assert.ok(!rowsOf("alice")[0].memberKeys.some((k) => k === "101" || k === "102"));
  });

  it("edits the row in place as films come back into reach, and goes when too few are left", async () => {
    await run(testContext().ctx, {});
    const [first] = rowsOf("alice");

    // Two years on, the film from six months ago is past the two-year line.
    c.setNow(NOW + 2 * YEAR);
    await run(testContext().ctx, {});
    const [second] = rowsOf("alice");
    assert.equal(second.ratingKey, first.ratingKey);
    assert.ok(second.memberKeys.includes("106"));
    assert.equal(plex.journal.pinned.length, 1, "pinned once, on creation");

    await run(testContext().ctx, { minYearsAgo: 6, minItems: 3 });
    assert.equal(rowsOf("alice").length, 0, "only Alien and Paddington 2 are six years back");
  });

  it("takes the row away when the person said it wasn't for them", async () => {
    await run(testContext().ctx, {});
    db.insert(userPreferences)
      .values({ userId: 10, preferences: { excludedCollections: ["Watch It Again"] }, optedIn: 1, updatedAt: NOW })
      .run();
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);
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

describe("pastFavourites", () => {
  it("leaves out anything never played and anything played after the line", () => {
    const base = { title: "x", completedPlays: 1, rating: null, copies: [] };
    assert.deepEqual(
      pastFavourites(
        [
          { ...base, identity: "a", lastPlayedAt: 0 },
          { ...base, identity: "b", lastPlayedAt: 100 },
          { ...base, identity: "c", lastPlayedAt: 50 },
        ],
        60,
      ).map((f) => f.identity),
      ["c"],
    );
  });

  it("watchAgainSummary reads naturally for one film", () => {
    assert.equal(watchAgainSummary(["Heat"]), "Films you loved a while back: Heat.");
  });
});
