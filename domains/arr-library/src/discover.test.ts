import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "@rube/db/test-db";
import { arrMovies, arrSeries, mediaItems } from "@rube/db";
import { createArrLibrary, discoverKey } from "./index.ts";

const NOW = 1_700_000_000_000;

function movie(over: Partial<typeof arrMovies.$inferInsert> = {}) {
  return {
    instanceId: "radarr",
    arrId: 7,
    title: "The Matrix",
    year: 1999,
    tmdbId: 603,
    monitored: true,
    hasFile: true,
    syncedAt: NOW,
    ...over,
  };
}

function series(over: Partial<typeof arrSeries.$inferInsert> = {}) {
  return {
    instanceId: "sonarr",
    arrId: 12,
    title: "Silo",
    year: 2023,
    tvdbId: 400002,
    monitored: true,
    episodeCount: 20,
    episodeFileCount: 10,
    syncedAt: NOW,
    ...over,
  };
}

function plexItem(over: Partial<typeof mediaItems.$inferInsert> = {}) {
  return {
    ratingKey: "1234",
    sectionId: "1",
    sectionTitle: "Movies",
    title: "The Matrix",
    type: "movie",
    tmdbId: 603,
    syncedAt: NOW,
    ...over,
  };
}

describe("discover — what you already hold", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.dispose());

  const lib = () => createArrLibrary({ db: t.db });

  it("finds a movie by tmdb id, and its Plex row", () => {
    t.db.insert(arrMovies).values(movie()).run();
    t.db.insert(mediaItems).values(plexItem()).run();

    const held = lib().annotateTmdbHits([{ tmdbId: 603, mediaType: "movie" }]);
    const hit = held.get(discoverKey("movie", 603))!;

    assert.deepEqual(hit.arr, [{ instanceId: "radarr", arrId: 7, monitored: true, hasFile: true }]);
    assert.equal(hit.plexRatingKey, "1234");
  });

  it("finds a series by tvdb id when the mirror has no tmdb id", () => {
    t.db
      .insert(arrSeries)
      .values(series({ tmdbId: null }))
      .run();

    const held = lib().annotateTmdbHits([{ tmdbId: 125988, mediaType: "tv", tvdbId: 400002 }]);
    const hit = held.get(discoverKey("tv", 125988))!;

    assert.deepEqual(hit.arr, [{ instanceId: "sonarr", arrId: 12, monitored: true, hasFile: true }]);
  });

  /**
   * `arr_series.tmdbId` is documented as not dependable, so it is the second
   * chance — but a hit whose TVDb id we never resolved still has to match.
   */
  it("falls back to the series tmdb id when no tvdb id was resolved", () => {
    t.db
      .insert(arrSeries)
      .values(series({ tmdbId: 125988 }))
      .run();

    const held = lib().annotateTmdbHits([{ tmdbId: 125988, mediaType: "tv" }]);
    assert.equal(held.get(discoverKey("tv", 125988))?.arr.length, 1);
  });

  it("counts one series matching on both ids once, not twice", () => {
    t.db
      .insert(arrSeries)
      .values(series({ tmdbId: 125988 }))
      .run();

    const held = lib().annotateTmdbHits([{ tmdbId: 125988, mediaType: "tv", tvdbId: 400002 }]);
    assert.equal(held.get(discoverKey("tv", 125988))?.arr.length, 1);
  });

  /**
   * A split 1080p/4K setup is the norm, and "which of my two Radarrs has this"
   * is exactly the question the annotation exists to answer. Collapsing them
   * would throw it away.
   */
  it("reports the same film in two instances as two holdings", () => {
    t.db.insert(arrMovies).values(movie()).run();
    t.db
      .insert(arrMovies)
      .values(movie({ instanceId: "radarr-4k", arrId: 9, hasFile: false }))
      .run();

    const held = lib().annotateTmdbHits([{ tmdbId: 603, mediaType: "movie" }]);
    assert.deepEqual(
      held
        .get(discoverKey("movie", 603))!
        .arr.map((a) => a.instanceId)
        .sort(),
      ["radarr", "radarr-4k"],
    );
  });

  /**
   * A record deleted from Radarr should offer an Add button again. Tombstones
   * exist so history survives the deletion, not so the record keeps claiming
   * to be there.
   */
  it("ignores tombstoned rows", () => {
    t.db
      .insert(arrMovies)
      .values(movie({ deletedAt: NOW }))
      .run();

    const held = lib().annotateTmdbHits([{ tmdbId: 603, mediaType: "movie" }]);
    assert.equal(held.get(discoverKey("movie", 603)), undefined);
  });

  /**
   * TMDb numbers films and shows in separate spaces, so the same number is two
   * different titles. Telling somebody they own a film they have never heard
   * of is the failure this key prevents.
   */
  it("does not confuse a movie id with a tv id of the same number", () => {
    t.db.insert(arrMovies).values(movie()).run();

    const held = lib().annotateTmdbHits([
      { tmdbId: 603, mediaType: "movie" },
      { tmdbId: 603, mediaType: "tv" },
    ]);
    assert.equal(held.get(discoverKey("movie", 603))?.arr.length, 1);
    assert.equal(held.get(discoverKey("tv", 603)), undefined);
  });

  it("asks nothing at all for an empty page", () => {
    assert.equal(lib().annotateTmdbHits([]).size, 0);
  });

  it("leaves a title nobody holds out of the map", () => {
    t.db.insert(arrMovies).values(movie()).run();
    assert.equal(lib().annotateTmdbHits([{ tmdbId: 999, mediaType: "movie" }]).size, 0);
  });
});

/**
 * The list-preview path. Its whole reason to exist is the IMDb-only entry:
 * MDBList and Trakt hand back an IMDb id for almost everything and a TMDb id
 * for most of it, and reusing the TMDb-keyed annotation would report "not
 * held" for every item missing the latter.
 */
describe("discover — what you hold, asked by external id", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.dispose());

  const lib = () => createArrLibrary({ db: t.db });

  it("matches a movie on its imdb id when the list carried no tmdb id", () => {
    t.db
      .insert(arrMovies)
      .values(movie({ tmdbId: null, imdbId: "tt0133093" }))
      .run();
    t.db
      .insert(mediaItems)
      .values(plexItem({ tmdbId: null, imdbId: "tt0133093" }))
      .run();

    const held = lib().annotateExternalHits([{ key: "0", mediaType: "movie", imdbId: "tt0133093" }]);
    const hit = held.get("0")!;

    assert.deepEqual(hit.arr, [{ instanceId: "radarr", arrId: 7, monitored: true, hasFile: true }]);
    assert.equal(hit.plexRatingKey, "1234");
  });

  it("counts a row matching on both ids once, not twice", () => {
    t.db
      .insert(arrMovies)
      .values(movie({ imdbId: "tt0133093" }))
      .run();

    const held = lib().annotateExternalHits([{ key: "0", mediaType: "movie", tmdbId: 603, imdbId: "tt0133093" }]);
    assert.equal(held.get("0")!.arr.length, 1);
  });

  it("matches a series on its imdb id, with episodes on disk standing in for hasFile", () => {
    t.db
      .insert(arrSeries)
      .values(series({ tvdbId: null, imdbId: "tt14688458" }))
      .run();

    const held = lib().annotateExternalHits([{ key: "x", mediaType: "tv", imdbId: "tt14688458" }]);
    assert.deepEqual(held.get("x")!.arr, [{ instanceId: "sonarr", arrId: 12, monitored: true, hasFile: true }]);
  });

  it("a tombstoned row is not held — the list should offer it again", () => {
    t.db
      .insert(arrMovies)
      .values(movie({ imdbId: "tt0133093", deletedAt: NOW }))
      .run();

    assert.equal(lib().annotateExternalHits([{ key: "0", mediaType: "movie", imdbId: "tt0133093" }]).size, 0);
  });

  /**
   * Two entries naming the same title is why the caller supplies the key: an
   * id-derived one would collapse them and the second row would render blank.
   */
  it("annotates every entry that names the same title", () => {
    t.db.insert(arrMovies).values(movie()).run();

    const held = lib().annotateExternalHits([
      { key: "0", mediaType: "movie", tmdbId: 603 },
      { key: "1", mediaType: "movie", tmdbId: 603 },
    ]);
    assert.equal(held.get("0")!.arr.length, 1);
    assert.equal(held.get("1")!.arr.length, 1);
  });

  it("does not confuse a movie id with a tv id of the same number", () => {
    t.db.insert(arrMovies).values(movie()).run();

    const held = lib().annotateExternalHits([
      { key: "movie", mediaType: "movie", tmdbId: 603 },
      { key: "tv", mediaType: "tv", tmdbId: 603 },
    ]);
    assert.equal(held.get("movie")!.arr.length, 1);
    assert.equal(held.get("tv"), undefined);
  });

  it("asks nothing at all for an empty list", () => {
    assert.equal(lib().annotateExternalHits([]).size, 0);
  });
});
