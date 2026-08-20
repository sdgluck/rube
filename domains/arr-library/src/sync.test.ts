import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createTestDb, type TestDb } from "@tinkerbell/db/test-db";
import { arrMovies, arrQualityProfiles, arrSeries, arrSyncState, mediaItems } from "@tinkerbell/db";
import { eq } from "drizzle-orm";
import { createArrLibrary } from "./index.ts";
import type { ArrInstance } from "@tinkerbell/core";

/** A mock Radarr serving whatever the test hands it. */
function mockArr(payloads: Record<string, unknown>) {
  let server: Server;
  function handler(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url!, "http://localhost").pathname;
    const body = payloads[path];
    res.writeHead(body === undefined ? 404 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body ?? []));
  }
  return {
    start(): Promise<string> {
      server = createServer(handler);
      return new Promise((r) =>
        server.listen(0, () => r(`http://127.0.0.1:${(server.address() as { port: number }).port}`)),
      );
    },
    stop: (): Promise<void> => new Promise((r) => server.close(() => r())),
  };
}

const BASE_PAYLOADS = {
  "/api/v3/system/status": { version: "5.2.6.8376", instanceName: "Radarr" },
  "/api/v3/qualityprofile": [{ id: 4, name: "HD-1080p", upgradeAllowed: true, cutoff: 7 }],
  "/api/v3/rootfolder": [{ id: 1, path: "/movies", accessible: true, freeSpace: 1000 }],
  "/api/v3/tag": [{ id: 2, label: "4k" }],
  "/api/v3/diskspace": [
    { path: "/", freeSpace: 10, totalSpace: 100 },
    { path: "/movies", freeSpace: 5000, totalSpace: 900_000 },
  ],
};

const MOVIE = {
  id: 7,
  title: "The Matrix",
  year: 1999,
  tmdbId: 603,
  imdbId: "tt0133093",
  monitored: true,
  hasFile: true,
  sizeOnDisk: 8_000_000_000,
  qualityProfileId: 4,
  rootFolderPath: "/movies",
  images: [{ coverType: "poster", url: "/MediaCover/7/poster.jpg", remoteUrl: "https://image.tmdb.org/p.jpg" }],
};

function instance(url: string, over: Partial<ArrInstance> = {}): ArrInstance {
  return { id: "radarr", service: "radarr", name: "Radarr", url, apiKey: "k", isDefault: true, ...over };
}

describe("arr library sync", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.dispose());

  it("mirrors a library and its configuration tables", async () => {
    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    const lib = createArrLibrary({ db: t.db });

    const res = await lib.syncInstance(instance(url));
    await mock.stop();

    assert.equal(res.synced, 1);
    assert.equal(res.error, undefined);

    const row = t.db.select().from(arrMovies).get()!;
    assert.equal(row.title, "The Matrix");
    assert.equal(row.tmdbId, 603);
    assert.equal(row.hasFile, true);
    assert.equal(row.sizeOnDisk, 8_000_000_000);
    assert.equal(t.db.select().from(arrQualityProfiles).get()?.name, "HD-1080p");
  });

  /**
   * The *Arr's own cover path needs the API key to fetch, so storing it would
   * either leak the key to the browser or render a broken image. Only the
   * provider CDN URL is safe to keep.
   */
  it("stores only the remote poster URL, never the *Arr's own cover path", async () => {
    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();

    await createArrLibrary({ db: t.db }).syncInstance(instance(url));
    await mock.stop();

    const row = t.db.select().from(arrMovies).get()!;
    assert.equal(row.posterUrl, "https://image.tmdb.org/p.jpg");
    assert.ok(!row.posterUrl.includes("MediaCover"));
  });

  it("links to a Plex row by tmdb id", async () => {
    t.db
      .insert(mediaItems)
      .values({
        ratingKey: "1234",
        sectionId: "1",
        sectionTitle: "Movies",
        title: "The Matrix",
        type: "movie",
        tmdbId: 603,
        versionCount: 1,
        syncedAt: Date.now(),
      })
      .run();

    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    await createArrLibrary({ db: t.db }).syncInstance(instance(url));
    await mock.stop();

    assert.equal(t.db.select().from(arrMovies).get()?.plexRatingKey, "1234");
  });

  // Null here is not a failure — it is the "downloaded, but Plex never scanned
  // it" case, which is the most useful thing reconciliation finds.
  it("leaves the Plex link null when nothing matches", async () => {
    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    await createArrLibrary({ db: t.db }).syncInstance(instance(url));
    await mock.stop();

    assert.equal(t.db.select().from(arrMovies).get()?.plexRatingKey, null);
  });

  it("reports how many records the link matched", async () => {
    t.db
      .insert(mediaItems)
      .values({
        ratingKey: "1234",
        sectionId: "1",
        sectionTitle: "Movies",
        title: "The Matrix",
        type: "movie",
        tmdbId: 603,
        versionCount: 1,
        syncedAt: Date.now(),
      })
      .run();

    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    const lib = createArrLibrary({ db: t.db });
    await lib.syncInstance(instance(url));
    await mock.stop();

    assert.equal(lib.linkToPlex("radarr", "radarr"), 1);
    assert.equal(lib.linkToPlex("sonarr", "sonarr"), 0);
  });

  /**
   * The bug that made this worth re-running: `media_items` gained its
   * provider-id columns in a migration, which backfills nothing, so every
   * mirror row read "Not in Plex" until the Plex sync had walked the library
   * *and* something re-ran the join. Re-linking is what `sync-media` now does
   * on the way out, and this is the sequence it has to survive.
   */
  it("links rows that were unmatched when the Plex ids were still missing", async () => {
    // The pre-migration state: a Plex row with no provider ids at all.
    const plexRow = {
      ratingKey: "1234",
      sectionId: "1",
      sectionTitle: "Movies",
      title: "The Matrix",
      type: "movie",
      versionCount: 1,
      syncedAt: Date.now(),
    };
    t.db.insert(mediaItems).values(plexRow).run();

    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    const lib = createArrLibrary({ db: t.db });
    await lib.syncInstance(instance(url));
    await mock.stop();

    assert.equal(t.db.select().from(arrMovies).get()?.plexRatingKey, null, "nothing to join on yet");

    // What a Plex sync does once it is parsing `Guid`.
    t.db.update(mediaItems).set({ tmdbId: 603 }).where(eq(mediaItems.ratingKey, "1234")).run();

    assert.equal(lib.linkToPlex("radarr", "radarr"), 1);
    assert.equal(t.db.select().from(arrMovies).get()?.plexRatingKey, "1234");
  });

  describe("tombstoning", () => {
    it("marks a vanished record deleted rather than removing the row", async () => {
      const first = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
      let url = await first.start();
      const lib = createArrLibrary({ db: t.db });
      await lib.syncInstance(instance(url));
      await first.stop();

      const second = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [] });
      url = await second.start();
      const res = await lib.syncInstance(instance(url));
      await second.stop();

      assert.equal(res.tombstoned, 1);
      const row = t.db.select().from(arrMovies).get();
      assert.ok(row, "the row must survive, so history outlives the record");
      assert.ok(row!.deletedAt !== null);
    });

    it("resurrects a record that comes back", async () => {
      const lib = createArrLibrary({ db: t.db });

      const a = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
      let url = await a.start();
      await lib.syncInstance(instance(url));
      await a.stop();

      const b = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [] });
      url = await b.start();
      await lib.syncInstance(instance(url));
      await b.stop();

      const c = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
      url = await c.start();
      await lib.syncInstance(instance(url));
      await c.stop();

      assert.equal(t.db.select().from(arrMovies).get()?.deletedAt, null);
    });

    it("does not tombstone another instance's rows", async () => {
      const lib = createArrLibrary({ db: t.db });

      const a = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
      let url = await a.start();
      await lib.syncInstance(instance(url, { id: "radarr-4k", name: "Radarr 4K", isDefault: false }));
      await a.stop();

      const b = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [] });
      url = await b.start();
      await lib.syncInstance(instance(url));
      await b.stop();

      const other = t.db.select().from(arrMovies).where(eq(arrMovies.instanceId, "radarr-4k")).get();
      assert.equal(other?.deletedAt, null);
    });
  });

  describe("an unreachable instance", () => {
    /**
     * A run covers every configured *Arr. One box being down must not cost the
     * others their sync, so this returns rather than throws — the same stance
     * `seerr-poll` takes.
     */
    it("reports the error instead of throwing", async () => {
      const res = await createArrLibrary({ db: t.db }).syncInstance(instance("http://127.0.0.1:9"));

      assert.ok(res.error);
      assert.equal(res.synced, 0);
    });

    it("records the failure on the instance state", async () => {
      const lib = createArrLibrary({ db: t.db });
      await lib.syncInstance(instance("http://127.0.0.1:9"));

      const state = t.db.select().from(arrSyncState).get();
      assert.ok(state?.lastError);
      assert.ok(state?.lastErrorAt);
    });

    // A stale failure must not sit on the instance card after the box is back.
    it("clears the error once a later run succeeds", async () => {
      const lib = createArrLibrary({ db: t.db });
      await lib.syncInstance(instance("http://127.0.0.1:9"));

      const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
      const url = await mock.start();
      await lib.syncInstance(instance(url));
      await mock.stop();

      assert.equal(t.db.select().from(arrSyncState).get()?.lastError, "");
    });

    // A failed sync must never be able to empty the mirror.
    it("does not tombstone anything", async () => {
      const lib = createArrLibrary({ db: t.db });
      const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
      const url = await mock.start();
      await lib.syncInstance(instance(url));
      await mock.stop();

      await lib.syncInstance(instance("http://127.0.0.1:9"));

      assert.equal(t.db.select().from(arrMovies).get()?.deletedAt, null);
    });
  });

  /**
   * The *Arrs report every mount they can see. Measuring a library against
   * `/` when it lives on `/movies` produces a number that is real and about
   * the wrong disk.
   */
  it("takes free space from the volume the library is actually on", async () => {
    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    await createArrLibrary({ db: t.db }).syncInstance(instance(url));
    await mock.stop();

    assert.equal(t.db.select().from(arrSyncState).get()?.diskFree, 5000);
  });

  // A missing disk figure must not cost the run its sync.
  it("still syncs when disk space cannot be read", async () => {
    const payloads = { ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] };
    delete (payloads as Record<string, unknown>)["/api/v3/diskspace"];
    const mock = mockArr(payloads);
    const url = await mock.start();

    const res = await createArrLibrary({ db: t.db }).syncInstance(instance(url));
    await mock.stop();

    assert.equal(res.synced, 1);
    assert.equal(res.error, undefined);
    assert.equal(t.db.select().from(arrSyncState).get()?.diskFree, null);
  });

  it("records the version and derived capabilities", async () => {
    const mock = mockArr({ ...BASE_PAYLOADS, "/api/v3/movie": [MOVIE] });
    const url = await mock.start();
    await createArrLibrary({ db: t.db }).syncInstance(instance(url));
    await mock.stop();

    const state = t.db.select().from(arrSyncState).get()!;
    assert.equal(state.arrVersion, "5.2.6.8376");
    assert.ok(state.capabilities?.includes("customFormats"));
    assert.equal(state.itemCount, 1);
  });
});

describe("sonarr sync", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.dispose());

  const SERIES = {
    id: 3,
    title: "The Wire",
    tvdbId: 79126,
    monitored: true,
    seasons: [{ seasonNumber: 1, monitored: true, statistics: { episodeCount: 13, episodeFileCount: 13 } }],
    statistics: { episodeCount: 60, episodeFileCount: 55, sizeOnDisk: 500 },
  };

  it("denormalises seasons onto the series row", async () => {
    const mock = mockArr({
      "/api/v3/system/status": { version: "4.0.1.929" },
      "/api/v3/qualityprofile": [],
      "/api/v3/rootfolder": [],
      "/api/v3/tag": [],
      "/api/v3/series": [SERIES],
    });
    const url = await mock.start();

    await createArrLibrary({ db: t.db }).syncInstance({
      id: "sonarr",
      service: "sonarr",
      name: "Sonarr",
      url,
      apiKey: "k",
      isDefault: true,
    });
    await mock.stop();

    const row = t.db.select().from(arrSeries).get()!;
    assert.equal(row.episodeFileCount, 55);
    assert.deepEqual(row.seasons, [
      { seasonNumber: 1, monitored: true, episodeCount: 13, episodeFileCount: 13, sizeOnDisk: 0 },
    ]);
  });
});
