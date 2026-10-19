/**
 * Season Collections end to end, through real HTTP to a mock Plex, with the
 * clock pinned so "is it Christmas" is the test's to say.
 *
 * What's protected: a holiday's row exists exactly while its window is open,
 * holds only titles filed under its keywords (not every December release),
 * keeps its Plex key from one day to the next, and doesn't pool its films with
 * another collection of the same name. Per person, it is theirs alone and goes
 * when they say it isn't for them.
 *
 * TMDb is never called: the cache rows are seeded fresh, which is the state a
 * library is in once any grouped rule or an earlier run has hydrated it.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, personalRowTitle, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, mediaItems, plexUsers, tmdbCache, userPreferences } from "@tinkerbell/db";
import { ClockToken } from "@tinkerbell/ports";
import { startMockPlex, type MockItem, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createSeasonCollectionsCommand, SEASON_LABEL } from "./index.ts";
import { createSeasonRemoveCommand } from "../season-remove.ts";

const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

const c = createTestContainer({ now: at("2026-12-10") });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createSeasonCollectionsCommand(services, { now: c.resolve(ClockToken) });
const { run: remove } = createSeasonRemoveCommand(services);

/** A film, its TMDb keywords, and its rating in the library index. */
interface Film {
  key: string;
  title: string;
  tmdb: number;
  keywords: number[];
  rating: number;
  month?: number;
}
const FILMS: Film[] = [
  { key: "100", title: "Elf", tmdb: 1001, keywords: [207317], rating: 7 },
  { key: "101", title: "Home Alone", tmdb: 1002, keywords: [5570, 1], rating: 8 },
  { key: "102", title: "Die Hard", tmdb: 1003, keywords: [260365], rating: 9 },
  // Released in December, about space: the old seasonal rule's false positive.
  { key: "103", title: "Space Thing", tmdb: 1004, keywords: [9882], rating: 6, month: 12 },
  { key: "104", title: "Hocus Pocus", tmdb: 1005, keywords: [3335], rating: 6 },
  { key: "105", title: "Halloween", tmdb: 1006, keywords: [3335, 9694], rating: 8 },
  { key: "106", title: "New Year Film", tmdb: 1007, keywords: [613], rating: 5 },
  { key: "107", title: "Another NYE", tmdb: 1008, keywords: [252123], rating: 6 },
];
const KLAUS: Film = { key: "108", title: "Klaus", tmdb: 1009, keywords: [1991], rating: 8 };

const item = (f: Film): MockItem => ({
  ratingKey: f.key,
  title: f.title,
  sectionId: "1",
  guids: [`tmdb://${f.tmdb}`],
  labels: [],
  year: 2000,
});

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

const rows = () => [...plex.collections.values()].filter((r) => r.labels.includes(SEASON_LABEL));
const rowFor = (season: string, user?: string) =>
  rows().filter((r) => r.labels.includes(`Season:${season}`) && (user ? r.labels.includes(`User:${user}`) : true));

/** Two of three is enough for a row here; the default minimum would need a bigger library. */
const CONFIG = { minItems: 2 };

before(async () => {
  plex = await startMockPlex({ sections: [{ key: "1", title: "Films", type: "movie" }], items: FILMS.map(item) });
});
after(async () => plex?.close());

beforeEach(() => {
  c.setNow(at("2026-12-10"));
  plex.collections.clear();
  plex.items.delete(KLAUS.key);
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("global_tmdb_api_key", "tmdb-key");
  setConfig("global_timezone", "UTC");
  setConfig("global_personalized_sharing", { status: "disabled" });
  for (const table of [plexUsers, mediaItems, userPreferences, tmdbCache]) db.delete(table).run();
  db.insert(tmdbCache)
    .values(
      [...FILMS, KLAUS].map((f) => ({
        id: `movie:${f.tmdb}`,
        tmdbId: f.tmdb,
        mediaType: "movie",
        data: { keywords: f.keywords, releaseMonth: f.month },
        // Real time, not the pinned clock: the cache's TTL reads `Date.now()`.
        fetchedAt: Date.now(),
      })),
    )
    .run();
  db.insert(mediaItems)
    .values(
      [...FILMS, KLAUS].map((f) => ({
        ratingKey: f.key,
        sectionId: "1",
        sectionTitle: "Films",
        title: f.title,
        type: "movie",
        rating: f.rating,
        genres: f.key === "100" ? ["Comedy"] : ["Action"],
        syncedAt: 0,
      })),
    )
    .run();
  db.insert(plexUsers)
    .values([
      { userId: 1, username: "owner", label: "owner", isOwner: 1, syncedAt: 0 },
      { userId: 10, username: "alice", label: "alice", syncedAt: 0 },
    ])
    .run();
});

describe("season-collections, one row for everyone", () => {
  it("builds the Christmas row from its keywords alone, pinned to every Home", async () => {
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);

    assert.equal(rows().length, 1, "only Christmas is in season on 10 December");
    const [row] = rowFor("christmas");
    assert.equal(displayTitle(row.title), "Christmas");
    assert.notEqual(row.title, "Christmas", "carries the per-season mark");
    assert.deepEqual(row.labels, ["Tinkerbell", SEASON_LABEL, "Season:christmas"]);
    // Best rated first, and no December space film.
    assert.deepEqual(row.memberKeys, ["102", "101", "100"]);
    assert.equal(row.summary, "Here for Christmas: 1 December – 26 December.");
    assert.deepEqual(plex.journal.pinHomes, [{ ratingKey: row.ratingKey, own: true, shared: true, recommended: true }]);
    assert.match(log.join("\n"), /In season: Christmas/);
  });

  it("edits the row in place the next day, keeping its key and pin", async () => {
    await run(testContext().ctx, CONFIG);
    const [first] = rowFor("christmas");

    plex.items.set(KLAUS.key, item(KLAUS));
    c.setNow(at("2026-12-11"));
    await run(testContext().ctx, CONFIG);

    const [second, ...more] = rowFor("christmas");
    assert.equal(more.length, 0);
    assert.equal(second.ratingKey, first.ratingKey);
    assert.deepEqual([...second.memberKeys].sort(), ["100", "101", "102", "108"]);
    assert.equal(plex.journal.pinned.length, 1, "pinned once, on creation");
  });

  it("takes Christmas down when it's over, and puts New Year's Eve up across the year end", async () => {
    await run(testContext().ctx, CONFIG);
    assert.equal(rowFor("christmas").length, 1);

    c.setNow(at("2026-12-30"));
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);
    assert.equal(rowFor("christmas").length, 0);
    assert.match(log.join("\n"), /Christmas is over/);
    assert.deepEqual([...rowFor("new_year")[0].memberKeys].sort(), ["106", "107"]);

    c.setNow(at("2027-01-01"));
    await run(testContext().ctx, CONFIG);
    assert.equal(rowFor("new_year").length, 1, "still New Year's Day");

    c.setNow(at("2027-01-03"));
    await run(testContext().ctx, CONFIG);
    assert.equal(rows().length, 0);
  });

  it("doesn't pool its films with another collection called Christmas", async () => {
    // A `seasonal` rule's own "Christmas" in the same library.
    plex.collections.set("9000", {
      ratingKey: "9000",
      title: "Christmas",
      sectionId: "1",
      labels: ["Tinkerbell"],
      memberKeys: ["101"],
    });
    await run(testContext().ctx, CONFIG);
    c.setNow(at("2027-01-03"));
    await run(testContext().ctx, CONFIG);
    assert.deepEqual(plex.collections.get("9000")?.memberKeys, ["101"], "the rule's collection is untouched");
  });

  it("rebuilds a season's row under its new name, and removes it when switched off", async () => {
    await run(testContext().ctx, CONFIG);
    await run(testContext().ctx, { ...CONFIG, seasons: { christmas: { name: "Xmas" } } });
    const [renamed, ...more] = rowFor("christmas");
    assert.equal(more.length, 0);
    assert.equal(displayTitle(renamed.title), "Xmas");

    await run(testContext().ctx, { ...CONFIG, seasons: { christmas: { enabled: false } } });
    assert.equal(rows().length, 0);
  });

  it("builds a custom season, and removes it when it is deleted", async () => {
    const custom = {
      key: "custom-santa",
      name: "Santa",
      activeFrom: "12-05",
      activeTo: "12-12",
      keywords: [
        { id: 1991, name: "santa claus" },
        { id: 1, name: "something" },
      ],
    };
    plex.items.set(KLAUS.key, item(KLAUS));
    await run(testContext().ctx, { ...CONFIG, customSeasons: [custom] });
    assert.deepEqual([...rowFor("custom-santa")[0].memberKeys].sort(), ["101", "108"]);

    await run(testContext().ctx, CONFIG);
    assert.equal(rowFor("custom-santa").length, 0);
  });

  it("makes no row when keywords find fewer than the minimum, and there's no AI to ask", async () => {
    const { ctx, log } = testContext();
    await run(ctx, { minItems: 5 });
    assert.equal(rows().length, 0);
    assert.match(log.join("\n"), /fewer than 5; no row/);
  });

  it("out of season it only sweeps, and needs no TMDb key", async () => {
    setConfig("global_tmdb_api_key", "");
    c.setNow(at("2026-04-10"));
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);
    assert.match(log.join("\n"), /Nothing is in season today/);
    assert.equal(plex.journal.unhandled.length, 0);
  });
});

describe("season-collections, a row per person", () => {
  const PER_USER = { ...CONFIG, mode: "per-user" as const };

  it("refuses to run until Personalized Home Screens is on", async () => {
    await assert.rejects(run(testContext().ctx, PER_USER), /Personalized Home Screens/);
  });

  it("builds each person's own row, and takes it away when they say it isn't for them", async () => {
    setConfig("global_personalized_sharing", { status: "enabled" });
    await run(testContext().ctx, PER_USER);

    const [alices] = rowFor("christmas", "alice");
    assert.equal(alices.title, personalRowTitle("Christmas picks for you", "alice"));
    assert.deepEqual(alices.labels, [SEASON_LABEL, "Season:christmas", "User:alice"]);
    assert.equal(rowFor("christmas", "owner").length, 1);
    assert.equal(rowFor("christmas").length, 2, "no shared row in this mode");

    db.insert(userPreferences)
      .values({
        userId: 10,
        preferences: { excludedCollections: ["Christmas picks for you"] },
        optedIn: 1,
        updatedAt: Date.now(),
      })
      .run();
    await run(testContext().ctx, PER_USER);
    assert.equal(rowFor("christmas", "alice").length, 0);
    assert.equal(rowFor("christmas", "owner").length, 1);
  });

  it("sweeps the row of someone who is no longer a user", async () => {
    setConfig("global_personalized_sharing", { status: "enabled" });
    await run(testContext().ctx, PER_USER);
    db.delete(plexUsers).run();
    db.insert(plexUsers).values({ userId: 1, username: "owner", label: "owner", isOwner: 1, syncedAt: 0 }).run();
    const { ctx, log } = testContext();
    await run(ctx, PER_USER);
    assert.equal(rowFor("christmas", "alice").length, 0);
    assert.match(log.join("\n"), /alice isn't one of the users/);
  });

  it("replaces the shared row when switched to per-person", async () => {
    await run(testContext().ctx, CONFIG);
    setConfig("global_personalized_sharing", { status: "enabled" });
    await run(testContext().ctx, PER_USER);
    assert.equal(rowFor("christmas").filter((r) => !r.labels.some((l) => l.startsWith("User:"))).length, 0);
  });
});

describe("season-remove", () => {
  it("deletes every row it made, and nothing else", async () => {
    await run(testContext().ctx, CONFIG);
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
    assert.deepEqual(plex.journal.unhandled, [], "no sharing calls, or anything else the mock doesn't serve");
  });
});
