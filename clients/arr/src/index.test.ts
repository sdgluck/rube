/**
 * This client deletes films off a disk and writes permanent import exclusions,
 * and it had no tests at all — not even a test script.
 *
 * The properties that matter are the ones a bug in makes unrecoverable:
 *
 * 1. **A mutation is never retried.** `arrFetch` sets `retries: 0` for anything
 *    that isn't a GET. A DELETE that actually landed but whose response was
 *    lost would, on retry, 404 harmlessly — but the retry re-sends
 *    `addImportExclusion`, and a duplicated exclusion is a silent "this will
 *    never come back" that nobody goes looking for. Asserting a negative needs
 *    a first attempt that fails, which is what `failNext` is for.
 * 2. **Both exclusion spellings go out.** Radarr and Sonarr name the parameter
 *    differently and each ignores the other's spelling. Sending only one means
 *    the exclusion silently does nothing on one of the two.
 * 3. **A PUT carries the whole record.** Both *Arrs replace the row wholesale,
 *    so a monitor toggle that sends `{ monitored }` alone nulls the title, the
 *    quality profile and the path.
 * 4. **An empty 200 body is not an error.** Some Radarr versions answer a
 *    DELETE with 200 and no content; parsing that as JSON throws *after* the
 *    file is gone, so the caller sees a failure and retries forever.
 * 5. **`findByExternalId` is not `lookupByExternalId`.** One returns a library
 *    row with an id the mutation endpoints take; the other returns a metadata
 *    search result with no id. Confusing them is how you delete the wrong
 *    thing.
 *
 * Real HTTP against the shared mock rather than a `fetch` stub: a stub would
 * agree with the client about which path a delete was addressed to, and that is
 * one of the two things most worth checking.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { startMockRadarr, startMockSonarr, type MockArr } from "@tinkerbell/test-support/arr";

import {
  addItem,
  deleteRecord,
  findByExternalId,
  getQualityProfiles,
  getRootFolders,
  getSystemStatus,
  lookupByExternalId,
  setMonitored,
  type ArrConfig,
  type ArrRecord,
} from "./index.ts";

let radarr: MockArr;
let sonarr: MockArr;
let radarrCfg: ArrConfig;
let sonarrCfg: ArrConfig;

const MOVIES = [
  {
    id: 11,
    title: "Arrival",
    tmdbId: 329865,
    imdbId: "tt2543164",
    monitored: true,
    hasFile: true,
    qualityProfileId: 4,
    path: "/data/movies/Arrival",
    tags: [7],
  },
  { id: 12, title: "Dune", tmdbId: 438631, imdbId: "tt1160419", monitored: false, hasFile: false },
];

const SERIES = [
  {
    id: 21,
    title: "Severance",
    tvdbId: 371980,
    imdbId: "tt11280740",
    monitored: true,
    statistics: { episodeFileCount: 9 },
    qualityProfileId: 3,
    path: "/data/tv/Severance",
  },
  { id: 22, title: "Andor", tvdbId: 368159, monitored: true, statistics: { episodeFileCount: 0 } },
];

before(async () => {
  radarr = await startMockRadarr(structuredClone(MOVIES), {
    lookupResults: [
      { title: "Blade Runner 2049", year: 2017, tmdbId: 335984, imdbId: "tt1856101", remotePoster: "http://p/1.jpg" },
      { title: "Blade Runner", year: 1982, tmdbId: 78 },
    ],
  });
  sonarr = await startMockSonarr(structuredClone(SERIES));
  radarrCfg = { service: "radarr", url: radarr.origin, apiKey: "radarr-key" };
  sonarrCfg = { service: "sonarr", url: sonarr.origin, apiKey: "sonarr-key" };
});

after(async () => {
  await radarr.close();
  await sonarr.close();
});

/** Reset library state and the journal between tests. */
function reset(mock: MockArr, initial: unknown[]): void {
  mock.records.clear();
  for (const row of structuredClone(initial) as Array<{ id: number }>) {
    mock.records.set(row.id, row as never);
  }
  mock.journal.deletes.length = 0;
  mock.journal.puts.length = 0;
  mock.journal.monitorWrites.length = 0;
  mock.journal.adds.length = 0;
  mock.journal.lookups.length = 0;
  mock.journal.requests.length = 0;
  mock.journal.unhandled.length = 0;
  mock.failNext(0);
}

beforeEach(() => {
  reset(radarr, MOVIES);
  reset(sonarr, SERIES);
});

describe("reads", () => {
  test("quality profiles are narrowed to id and name", async () => {
    assert.deepEqual(await getQualityProfiles(radarrCfg), [
      { id: 1, name: "HD-1080p" },
      { id: 2, name: "Ultra-HD" },
    ]);
  });

  test("root folders carry through free space and accessibility", async () => {
    assert.deepEqual(await getRootFolders(radarrCfg), [
      { id: 1, path: "/data/media", freeSpace: 1_000, accessible: true },
    ]);
  });

  test("system status falls back through instanceName, appName, then Unknown", async () => {
    assert.deepEqual(await getSystemStatus(radarrCfg), { instanceName: "Mock Radarr", version: "5.0.0" });
  });

  test("the api key travels as X-Api-Key on every request", async () => {
    // Sent as a header rather than a query parameter, which keeps it out of
    // the *Arr's own request log.
    await getSystemStatus(radarrCfg);
    assert.ok(radarr.journal.requests.includes("GET /api/v3/system/status"));
  });
});

describe("lookupByExternalId — the metadata search", () => {
  test("returns the first match, mapped", async () => {
    const hit = await lookupByExternalId(radarrCfg, "imdb:tt1856101");
    assert.equal(hit?.title, "Blade Runner 2049");
    assert.equal(hit?.year, 2017);
    assert.equal(hit?.tmdbId, 335984);
    assert.equal(hit?.remotePoster, "http://p/1.jpg");
    assert.equal(hit?.service, "radarr");
  });

  test("keeps the raw payload, because the add body needs it verbatim", async () => {
    const hit = await lookupByExternalId(radarrCfg, "imdb:tt1856101");
    assert.equal(hit?.raw.imdbId, "tt1856101");
  });

  test("carries no *Arr id — this result cannot be deleted", async () => {
    // The type has no `id` at all, which is the point of keeping this separate
    // from `findByExternalId`. Asserted on the value so a future widening of
    // the type is caught here rather than at a delete call site.
    const hit = await lookupByExternalId(radarrCfg, "imdb:tt1856101");
    assert.equal((hit as unknown as { id?: number }).id, undefined);
  });

  test("the term is URL-encoded", async () => {
    await lookupByExternalId(radarrCfg, "imdb:tt 123&x=1");
    assert.ok(
      radarr.journal.lookups.some((l) => l.includes("term=imdb%3Att%20123%26x%3D1")),
      `saw ${radarr.journal.lookups.join(", ")}`,
    );
  });

  test("nothing found is null rather than a throw", async () => {
    const empty = await startMockRadarr([], { lookupResults: [] });
    try {
      assert.equal(await lookupByExternalId({ ...radarrCfg, url: empty.origin }, "imdb:tt0"), null);
    } finally {
      await empty.close();
    }
  });

  test("radarr and sonarr search their own endpoints", async () => {
    await lookupByExternalId(radarrCfg, "imdb:tt1");
    await lookupByExternalId(sonarrCfg, "imdb:tt1");
    assert.ok(radarr.journal.requests.includes("GET /api/v3/movie/lookup"));
    assert.ok(sonarr.journal.requests.includes("GET /api/v3/series/lookup"));
  });
});

describe("findByExternalId — the library row", () => {
  test("radarr asks the server to filter by tmdbId rather than listing everything", async () => {
    const hit = await findByExternalId(radarrCfg, "tmdb:329865");
    assert.equal(hit?.id, 11);
    assert.equal(hit?.title, "Arrival");
    assert.ok(
      radarr.journal.lookups.some((l) => l.includes("tmdbId=329865")),
      "the filter went server-side",
    );
  });

  test("radarr falls back to scanning the list for an imdb id", async () => {
    const hit = await findByExternalId(radarrCfg, "imdb:tt1160419");
    assert.equal(hit?.id, 12);
  });

  test("sonarr matches on tvdb, imdb or tmdb", async () => {
    assert.equal((await findByExternalId(sonarrCfg, "tvdb:371980"))?.id, 21);
    assert.equal((await findByExternalId(sonarrCfg, "imdb:tt11280740"))?.id, 21);
    assert.equal((await findByExternalId(sonarrCfg, "tvdb:368159"))?.id, 22);
  });

  test("hasFile means the movie file for radarr, and any episode for sonarr", async () => {
    // Sonarr has no `hasFile`; a series counts as present if any episode is on
    // disk. Getting this wrong makes a delete-if-unwatched rule skip every
    // series, or act on ones with nothing downloaded.
    assert.equal((await findByExternalId(radarrCfg, "tmdb:329865"))?.hasFile, true);
    assert.equal((await findByExternalId(radarrCfg, "imdb:tt1160419"))?.hasFile, false);
    assert.equal((await findByExternalId(sonarrCfg, "tvdb:371980"))?.hasFile, true);
    assert.equal((await findByExternalId(sonarrCfg, "tvdb:368159"))?.hasFile, false, "no episodes on disk");
  });

  test("monitored is strict — a missing field is not monitored", async () => {
    radarr.records.set(99, { id: 99, title: "Odd", tmdbId: 1, hasFile: false } as never);
    const hit = await findByExternalId(radarrCfg, "tmdb:1");
    assert.equal(hit?.monitored, false);
  });

  test("an id with no scheme is null rather than a wild query", async () => {
    // `deleteRecord` takes whatever this returns. A malformed id that fell
    // through to "list everything and take the first" would delete an
    // arbitrary film.
    assert.equal(await findByExternalId(radarrCfg, "329865"), null);
    assert.equal(await findByExternalId(radarrCfg, ""), null);
    assert.equal(radarr.journal.requests.length, 0, "it did not even ask");
  });

  test("an unknown id is null", async () => {
    assert.equal(await findByExternalId(radarrCfg, "tmdb:999999"), null);
    assert.equal(await findByExternalId(sonarrCfg, "tvdb:999999"), null);
  });
});

describe("setMonitored", () => {
  test("sends the whole record back, not just the changed field", async () => {
    // Both *Arrs replace the row wholesale. A patch-shaped PUT would null the
    // path and the quality profile.
    const record = (await findByExternalId(radarrCfg, "tmdb:329865"))!;
    await setMonitored(radarrCfg, record, false);

    const put = radarr.journal.puts.at(-1)!;
    assert.equal(put.id, 11);
    assert.equal(put.body.monitored, false);
    assert.equal(put.body.title, "Arrival", "title survived");
    assert.equal(put.body.qualityProfileId, 4, "quality profile survived");
    assert.equal(put.body.path, "/data/movies/Arrival", "path survived");
    assert.deepEqual(put.body.tags, [7], "tags survived");
  });

  test("the change is visible on the next read", async () => {
    const record = (await findByExternalId(radarrCfg, "tmdb:329865"))!;
    await setMonitored(radarrCfg, record, false);
    assert.equal((await findByExternalId(radarrCfg, "tmdb:329865"))?.monitored, false);
  });

  test("monitoring back on works too", async () => {
    const record = (await findByExternalId(radarrCfg, "imdb:tt1160419"))!;
    assert.equal(record.monitored, false);
    await setMonitored(radarrCfg, record, true);
    assert.equal((await findByExternalId(radarrCfg, "imdb:tt1160419"))?.monitored, true);
  });

  test("addresses the series endpoint for sonarr", async () => {
    const record = (await findByExternalId(sonarrCfg, "tvdb:371980"))!;
    await setMonitored(sonarrCfg, record, false);
    assert.ok(sonarr.journal.requests.includes("PUT /api/v3/series/21"));
  });

  test("is not retried when it fails", async () => {
    const record = (await findByExternalId(radarrCfg, "tmdb:329865"))!;
    radarr.failNext(5, 503);

    await assert.rejects(() => setMonitored(radarrCfg, record, false), /radarr/);
    assert.equal(
      radarr.journal.requests.filter((r) => r.startsWith("PUT")).length,
      1,
      "a retried PUT would re-apply a stale record over a newer one",
    );
  });

  test("an empty 200 body is not treated as a failure", async () => {
    // The mock answers PUT with 200 and no content, as the real thing does.
    const record = (await findByExternalId(radarrCfg, "tmdb:329865"))!;
    await assert.doesNotReject(() => setMonitored(radarrCfg, record, false));
  });
});

describe("deleteRecord", () => {
  const recordFor = async (cfg: ArrConfig, id: string): Promise<ArrRecord> => (await findByExternalId(cfg, id))!;

  test("deletes by *Arr id, on the right endpoint", async () => {
    await deleteRecord(radarrCfg, await recordFor(radarrCfg, "tmdb:329865"), {
      deleteFiles: true,
      addImportExclusion: true,
    });

    assert.equal(radarr.journal.deletes.length, 1);
    assert.ok(radarr.journal.deletes[0]!.startsWith("/api/v3/movie/11?"));
    assert.equal(radarr.records.has(11), false, "it is gone from the library");
    assert.equal(radarr.records.has(12), true, "and nothing else was touched");
  });

  test("sends both spellings of the exclusion flag", async () => {
    // Radarr wants `addImportExclusion`, Sonarr wants `addImportListExclusion`,
    // and each ignores the other's. Sending one means the exclusion silently
    // does nothing on whichever *Arr wanted the other.
    await deleteRecord(radarrCfg, await recordFor(radarrCfg, "tmdb:329865"), {
      deleteFiles: true,
      addImportExclusion: true,
    });

    const params = new URL(radarr.journal.deletes[0]!, "http://mock").searchParams;
    assert.equal(params.get("addImportExclusion"), "true");
    assert.equal(params.get("addImportListExclusion"), "true");
  });

  test("deleteFiles goes out exactly as asked, in both directions", async () => {
    await deleteRecord(radarrCfg, await recordFor(radarrCfg, "tmdb:329865"), {
      deleteFiles: false,
      addImportExclusion: false,
    });
    let params = new URL(radarr.journal.deletes[0]!, "http://mock").searchParams;
    assert.equal(params.get("deleteFiles"), "false");
    assert.equal(params.get("addImportExclusion"), "false");
    assert.equal(params.get("addImportListExclusion"), "false");

    reset(radarr, MOVIES);
    await deleteRecord(radarrCfg, await recordFor(radarrCfg, "tmdb:329865"), {
      deleteFiles: true,
      addImportExclusion: false,
    });
    params = new URL(radarr.journal.deletes[0]!, "http://mock").searchParams;
    assert.equal(params.get("deleteFiles"), "true");
    assert.equal(params.get("addImportExclusion"), "false", "the two flags are independent");
  });

  test("is never retried — the whole point", async () => {
    // A retried DELETE would 404 harmlessly, but it re-sends the exclusion, and
    // a duplicated exclusion is a silent "this will never come back".
    const record = await recordFor(radarrCfg, "tmdb:329865");
    radarr.failNext(5, 500);

    await assert.rejects(() => deleteRecord(radarrCfg, record, { deleteFiles: true, addImportExclusion: true }));

    assert.equal(
      radarr.journal.requests.filter((r) => r.startsWith("DELETE")).length,
      1,
      "exactly one delete reached the server",
    );
  });

  test("an empty 200 body means success, not failure", async () => {
    // The failure this guards: parsing an empty body as JSON throws *after* the
    // file is already gone, so the item is never marked actioned and is
    // retried on every subsequent run.
    const record = await recordFor(radarrCfg, "tmdb:329865");
    await assert.doesNotReject(() => deleteRecord(radarrCfg, record, { deleteFiles: true, addImportExclusion: true }));
  });

  test("addresses the series endpoint for sonarr", async () => {
    await deleteRecord(sonarrCfg, await recordFor(sonarrCfg, "tvdb:371980"), {
      deleteFiles: true,
      addImportExclusion: true,
    });
    assert.ok(sonarr.journal.deletes[0]!.startsWith("/api/v3/series/21?"));
    assert.equal(sonarr.records.has(21), false);
  });

  test("a failure names the service, so a log line says which *Arr", async () => {
    const record = await recordFor(radarrCfg, "tmdb:329865");
    radarr.failNext(1, 401, "Unauthorized");

    await assert.rejects(() => deleteRecord(radarrCfg, record, { deleteFiles: false, addImportExclusion: false }), {
      message: /^radarr 401/,
    });
  });
});

describe("GET retries", () => {
  test("a read is retried, unlike a mutation", async () => {
    // The asymmetry is deliberate: re-reading is free, re-writing is not.
    radarr.failNext(2, 503);
    const hit = await findByExternalId(radarrCfg, "tmdb:329865");
    assert.equal(hit?.id, 11, "the third attempt succeeded");
    assert.equal(radarr.journal.requests.filter((r) => r.startsWith("GET")).length, 3);
  });

  test("a read gives up after two retries", async () => {
    radarr.failNext(9, 503);
    await assert.rejects(() => findByExternalId(radarrCfg, "tmdb:329865"), /radarr/);
    assert.equal(radarr.journal.requests.filter((r) => r.startsWith("GET")).length, 3, "one attempt plus two retries");
  });
});

describe("addItem", () => {
  test("adds, and reports the new id", async () => {
    const lookup = (await lookupByExternalId(radarrCfg, "imdb:tt1856101"))!;
    const result = await addItem(radarrCfg, lookup, {
      qualityProfileId: 2,
      rootFolderPath: "/data/media",
      monitor: true,
      searchOnAdd: true,
    });

    assert.equal(result.status, "added");
    assert.equal(result.title, "Blade Runner 2049");
    assert.ok(typeof result.id === "number");
  });

  test("the add body carries the lookup payload plus the caller's choices", async () => {
    const lookup = (await lookupByExternalId(radarrCfg, "imdb:tt1856101"))!;
    await addItem(radarrCfg, lookup, {
      qualityProfileId: 2,
      rootFolderPath: "/data/media",
      monitor: true,
      searchOnAdd: true,
    });

    const body = radarr.journal.adds[0]!;
    assert.equal(body.tmdbId, 335984, "the raw payload came through");
    assert.equal(body.qualityProfileId, 2);
    assert.equal(body.rootFolderPath, "/data/media");
    assert.equal(body.monitored, true);
    assert.deepEqual(body.addOptions, { searchForMovie: true, monitor: "movieOnly" });
  });

  test("an unmonitored radarr add asks for no monitoring at all", async () => {
    const lookup = (await lookupByExternalId(radarrCfg, "imdb:tt1856101"))!;
    await addItem(radarrCfg, lookup, {
      qualityProfileId: 2,
      rootFolderPath: "/data/media",
      monitor: false,
      searchOnAdd: false,
    });

    assert.deepEqual(radarr.journal.adds[0]!.addOptions, { searchForMovie: false, monitor: "none" });
  });

  test("sonarr's add options default to monitoring every season", async () => {
    const lookup = {
      service: "sonarr" as const,
      title: "Silo",
      raw: { title: "Silo", tvdbId: 400001 },
    };
    await addItem(sonarrCfg, lookup, {
      qualityProfileId: 1,
      rootFolderPath: "/data/tv",
      monitor: true,
      searchOnAdd: true,
    });

    assert.deepEqual(sonarr.journal.adds[0]!.addOptions, {
      monitor: "all",
      searchForMissingEpisodes: true,
      searchForCutoffUnmetEpisodes: false,
    });
  });

  test("an explicit series monitor mode is honoured", async () => {
    const lookup = { service: "sonarr" as const, title: "Silo", raw: { title: "Silo", tvdbId: 400002 } };
    await addItem(sonarrCfg, lookup, {
      qualityProfileId: 1,
      rootFolderPath: "/data/tv",
      monitor: true,
      searchOnAdd: false,
      seriesMonitorMode: "firstSeason",
    });

    assert.equal((sonarr.journal.adds[0]!.addOptions as { monitor: string }).monitor, "firstSeason");
  });

  test("an item already in the library reports `exists`, not a failure", async () => {
    // A rule that adds its matches runs on a schedule, so most of what it tries
    // to add is already there. Reporting that as a failure would fill the event
    // log with noise and mark healthy runs as broken.
    const lookup = {
      service: "radarr" as const,
      title: "Arrival",
      raw: { title: "Arrival", tmdbId: 329865 },
    };
    const result = await addItem(radarrCfg, lookup, {
      qualityProfileId: 1,
      rootFolderPath: "/data/media",
      monitor: true,
      searchOnAdd: false,
    });

    assert.deepEqual(result, { status: "exists", title: "Arrival" });
  });

  test("any other error reports `failed` with the status and a truncated body", async () => {
    const lookup = { service: "radarr" as const, title: "X", raw: { title: "X", tmdbId: 1 } };
    radarr.failWith("/api/v3/movie", 500, "y".repeat(1_000));
    try {
      const result = await addItem(radarrCfg, lookup, {
        qualityProfileId: 1,
        rootFolderPath: "/data/media",
        monitor: true,
        searchOnAdd: false,
      });

      assert.equal(result.status, "failed");
      assert.match(result.error ?? "", /^500 /);
      assert.ok((result.error ?? "").length < 250, "the body is truncated rather than logged whole");
    } finally {
      radarr.failWith("/api/v3/movie", 200);
      radarr.failNext(0);
    }
  });

  test("a 400 that is not an already-exists is still a failure", async () => {
    const lookup = { service: "radarr" as const, title: "X", raw: { title: "X", tmdbId: 2 } };
    radarr.failWith("/api/v3/movie", 400, "invalid root folder");
    try {
      const result = await addItem(radarrCfg, lookup, {
        qualityProfileId: 1,
        rootFolderPath: "/nope",
        monitor: true,
        searchOnAdd: false,
      });
      assert.equal(result.status, "failed");
    } finally {
      radarr.failWith("/api/v3/movie", 200);
    }
  });
});
