/**
 * The add path, against a real Radarr on real HTTP.
 *
 * Everything interesting in `discover.add` happens on the wire: which term the
 * lookup goes out with, which of several candidates is chosen, what the POST
 * body ends up containing, and how an already-added 400 is read. A `fetch`
 * stub would agree with this file about all four.
 *
 * The Sonarr branch's TMDb→TVDb hop is covered at the client seam
 * (`clients/tmdb/src/search.test.ts`) rather than here: `fetchTvExternalIds`
 * talks to api.themoviedb.org and the only honest way to redirect it from this
 * layer would be a production config key that exists for tests.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { initTRPC, TRPCError } from "@trpc/server";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { ConfigStoreToken } from "@rube/core";
import { DbToken, arrMovies } from "@rube/db";
import { JobsToken, registerJobs } from "@rube/jobs";
import { startMockRadarr, startMockMdblist, startMockTrakt, type MockArr } from "@rube/test-support";
import { createMdblistClient } from "@rube/mdblist";
import { createTraktClient } from "@rube/trakt";
import { createTrpc } from "./index.ts";
import type { AdminContext } from "./_base.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const db = c.resolve(DbToken);
const setConfigStore = c.resolve(ConfigStoreToken);
const { setConfig } = setConfigStore;
const services = c.resolve(ServicesToken);

/**
 * The two list providers point at mock servers instead of the internet.
 *
 * Swapped on the deps object the routers are built from rather than on
 * `ClientsToken`, because that is the seam `createTrpc` already takes — and
 * because the alternative would be a base-url config key that exists only for
 * tests. The origins are mutable because a server's port isn't known until it
 * is listening, which is after the router is built.
 */
let mdblistOrigin: string | undefined;
let traktOrigin: string | undefined;

const { appRouter } = createTrpc({
  ...services,
  clients: {
    ...services.clients,
    getMdblistClient: () =>
      createMdblistClient({
        apiKey: setConfigStore.getConfig("global_mdblist_api_key") || null,
        baseUrl: mdblistOrigin,
      }),
    getTraktClient: () =>
      createTraktClient({ clientId: setConfigStore.getConfig("global_trakt_client_id") || null, baseUrl: traktOrigin }),
  },
  jobs: c.resolve(JobsToken),
});

function caller() {
  const ctx = {
    session: undefined,
    resHeaders: new Headers(),
    secure: false,
    origin: "http://admin.rube.test",
    ip: "test",
    authRequired: false,
  } as unknown as AdminContext;
  return initTRPC.context<AdminContext>().create().createCallerFactory(appRouter)(ctx);
}

/**
 * Two candidates, and the one we want is **not** first.
 *
 * Radarr's lookup answers with more than the exact hit, so taking `[0]` adds a
 * different film from the one that was clicked — a failure that looks like a
 * successful add right up until it appears in the library.
 */
const LOOKUP_RESULTS = [
  { title: "The Matrix Reloaded", tmdbId: 604, year: 2003, images: [] },
  { title: "The Matrix", tmdbId: 603, year: 1999, imdbId: "tt0133093", images: [] },
];

const ADD_INPUT = {
  mediaType: "movie" as const,
  tmdbId: 603,
  qualityProfileId: 2,
  rootFolderPath: "/data/media",
  monitor: true,
  searchOnAdd: true,
};

let radarr: MockArr;

async function useRadarr(initial: Parameters<typeof startMockRadarr>[0] = []) {
  radarr = await startMockRadarr(initial, { lookupResults: LOOKUP_RESULTS });
  setConfig("global_radarr_url", radarr.origin);
  setConfig("global_radarr_api_key", "key");
  return radarr;
}

describe("discover.status", () => {
  beforeEach(() => {
    setConfig("global_tmdb_api_key", "");
    setConfig("global_radarr_url", "");
    setConfig("global_radarr_api_key", "");
    setConfig("global_mdblist_api_key", "");
    setConfig("global_trakt_client_id", "");
  });

  /**
   * The page needs this so it can render a "configure TMDb" prompt *instead of*
   * searching. Learning the key is missing by firing a doomed search is a
   * wasted request and an error state standing in for a setup step.
   */
  test("reports what is configured without touching the network", async () => {
    assert.deepEqual(await caller().discover.status(), {
      tmdb: false,
      radarr: false,
      sonarr: false,
      mdblist: false,
      trakt: false,
    });
    setConfig("global_tmdb_api_key", "k");
    setConfig("global_mdblist_api_key", "mk");
    await useRadarr();
    assert.deepEqual(await caller().discover.status(), {
      tmdb: true,
      radarr: true,
      sonarr: false,
      // Whether a key exists, never the key — both are in `SECRET_KEYS`.
      mdblist: true,
      trakt: false,
    });
    await radarr.close();
  });
});

describe("discover.search", () => {
  test("an unconfigured TMDb is a 412, not a 500 — it is a setup step", async () => {
    setConfig("global_tmdb_api_key", "");
    await assert.rejects(
      () => caller().discover.search({ term: "matrix" }),
      (err: TRPCError) => err.code === "PRECONDITION_FAILED",
    );
  });
});

describe("discover.add", () => {
  beforeEach(() => {
    db.delete(arrMovies).run();
    setConfig("global_tmdb_api_key", "k");
  });

  test("looks the candidate up by tmdb id before posting it", async () => {
    await useRadarr();
    const result = await caller().discover.add(ADD_INPUT);
    await radarr.close();

    assert.equal(result.status, "added");
    assert.equal(result.title, "The Matrix");
    assert.equal(result.instanceId, "radarr");
    assert.ok(
      radarr.journal.lookups.some((l) => l.includes("term=tmdb%3A603")),
      `saw ${radarr.journal.lookups.join(", ")}`,
    );
    assert.deepEqual(radarr.journal.requests.slice(0, 2), ["GET /api/v3/movie/lookup", "POST /api/v3/movie"]);
  });

  test("posts the candidate matching the id, not whichever came back first", async () => {
    await useRadarr();
    await caller().discover.add(ADD_INPUT);
    await radarr.close();

    const body = radarr.journal.adds[0];
    assert.equal(body.tmdbId, 603);
    assert.equal(body.title, "The Matrix");
  });

  test("the body is the lookup payload plus the caller's choices", async () => {
    await useRadarr();
    await caller().discover.add({ ...ADD_INPUT, minimumAvailability: "released", searchOnAdd: false });
    await radarr.close();

    const body = radarr.journal.adds[0];
    // From the lookup, verbatim — the *Arr will not accept a body we invented.
    assert.equal(body.imdbId, "tt0133093");
    // From the caller.
    assert.equal(body.qualityProfileId, 2);
    assert.equal(body.rootFolderPath, "/data/media");
    assert.equal(body.monitored, true);
    assert.equal(body.minimumAvailability, "released");
    assert.deepEqual(body.addOptions, { searchForMovie: false, monitor: "movieOnly" });
  });

  /**
   * Two people can want the same film, and a split 1080p/4K setup makes it
   * routine. "Already there" is an outcome, not a failure — and it is what
   * makes the deliberately conservative presence matching in `annotateTmdbHits`
   * safe to get wrong in the harmless direction.
   */
  test("an already-added film reports exists, and does not throw", async () => {
    await useRadarr([{ id: 1, title: "The Matrix", tmdbId: 603, monitored: true, hasFile: true }]);
    const result = await caller().discover.add(ADD_INPUT);
    await radarr.close();

    assert.equal(result.status, "exists");
  });

  /**
   * Without this the "already added" badge would be wrong until the 00:30
   * sync, which is long enough for somebody to add the same film twice.
   */
  test("writes the new record through to the mirror", async () => {
    await useRadarr();
    await caller().discover.add(ADD_INPUT);
    await radarr.close();

    const row = db.select().from(arrMovies).get();
    assert.equal(row?.tmdbId, 603);
    assert.equal(row?.instanceId, "radarr");
  });

  test("a film the *Arr cannot find is a 404, not a silent no-op", async () => {
    radarr = await startMockRadarr([], { lookupResults: [] });
    setConfig("global_radarr_url", radarr.origin);
    setConfig("global_radarr_api_key", "key");

    await assert.rejects(
      () => caller().discover.add(ADD_INPUT),
      (err: TRPCError) => err.code === "NOT_FOUND",
    );
    await radarr.close();
  });

  test("an unconfigured Radarr is a 412", async () => {
    setConfig("global_radarr_url", "");
    setConfig("global_radarr_api_key", "");
    await assert.rejects(
      () => caller().discover.add(ADD_INPUT),
      (err: TRPCError) => err.code === "PRECONDITION_FAILED",
    );
  });
});

/**
 * List search, against two mock providers on real HTTP.
 *
 * The interesting behaviour is all in the fan-out: which providers are asked,
 * what happens when one of them doesn't answer, and whether a list item that
 * carries only an IMDb id is recognised as something you already hold. A
 * `fetch` stub would agree with this file about all three.
 */
describe("discover.lists", () => {
  const MDBLIST_LIST = {
    summary: { id: 2410, name: "Horror Movies", slug: "horror", owner: "hdlists", itemCount: 2, likes: 139 },
    items: [
      // No TMDb id at all — the case `annotateTmdbHits` cannot see.
      { title: "Alien", year: 1979, mediaType: "movie" as const, imdbId: "tt0078748", tmdbId: null },
      { title: "The Thing", year: 1982, mediaType: "movie" as const, imdbId: "tt0084787", tmdbId: 1091 },
    ],
  };
  const TRAKT_LIST = {
    summary: { id: 8842, name: "Best of 2024", slug: "best", owner: "someone", itemCount: 0, likes: 900 },
    items: [],
  };

  beforeEach(() => {
    db.delete(arrMovies).run();
    setConfig("global_mdblist_api_key", "");
    setConfig("global_trakt_client_id", "");
    mdblistOrigin = undefined;
    traktOrigin = undefined;
  });

  async function useMdblist() {
    const server = await startMockMdblist([MDBLIST_LIST]);
    mdblistOrigin = server.origin;
    setConfig("global_mdblist_api_key", "mk");
    return server;
  }

  async function useTrakt() {
    const server = await startMockTrakt([TRAKT_LIST]);
    traktOrigin = server.origin;
    setConfig("global_trakt_client_id", "cid");
    return server;
  }

  test("searches only the providers that are configured, and says which aren't", async () => {
    const mdblist = await useMdblist();
    const result = await caller().discover.lists.search({ term: "horror" });
    await mdblist.close();

    assert.deepEqual(
      result.results.map((r) => [r.provider, r.listId, r.name]),
      [["mdblist", "2410", "Horror Movies"]],
    );
    // An unconfigured provider is a setup step to report, not an error to raise
    // — the results that did arrive are still worth showing.
    assert.deepEqual(result.unconfigured, ["trakt"]);
    assert.deepEqual(result.failed, []);
  });

  test("merges both providers, most-liked first", async () => {
    const mdblist = await useMdblist();
    const trakt = await useTrakt();
    const result = await caller().discover.lists.search({ term: "best" });
    await Promise.all([mdblist.close(), trakt.close()]);

    // Trakt's 900 likes outrank MDBList's 139; no other ordering means the
    // same thing on both sides of the merge.
    assert.deepEqual(
      result.results.map((r) => r.provider),
      ["trakt", "mdblist"],
    );
    assert.deepEqual(result.unconfigured, []);
  });

  test("one provider failing costs its results, not the whole tab", async () => {
    const mdblist = await useMdblist();
    const trakt = await useTrakt();
    // A 500 is not on the retryable list (429/502/503/504), so one is enough
    // and the test doesn't pay for a backoff.
    trakt.failNext(1, 500);

    const result = await caller().discover.lists.search({ term: "horror" });
    await Promise.all([mdblist.close(), trakt.close()]);

    assert.deepEqual(result.failed, ["trakt"]);
    assert.deepEqual(
      result.results.map((r) => r.provider),
      ["mdblist"],
    );
  });

  test("the browse state asks for popular lists rather than nothing", async () => {
    const mdblist = await useMdblist();
    const result = await caller().discover.lists.top();
    await mdblist.close();

    assert.equal(result.results.length, 1);
    assert.ok(mdblist.journal.requests.some((r) => r.startsWith("GET /lists/top")));
  });

  test("an unconfigured provider is a 412 on preview, not a 500", async () => {
    await assert.rejects(
      () => caller().discover.lists.preview({ provider: "mdblist", listId: "2410" }),
      (err: TRPCError) => err.code === "PRECONDITION_FAILED",
    );
  });

  test("a preview marks a title held on its IMDb id alone", async () => {
    const mdblist = await useMdblist();
    db.insert(arrMovies)
      .values({
        instanceId: "radarr",
        arrId: 7,
        // Deliberately no TMDb id: this row is only findable by IMDb, which is
        // exactly the case the TMDb-keyed annotation misses.
        tmdbId: null,
        imdbId: "tt0078748",
        title: "Alien",
        monitored: true,
        hasFile: true,
        syncedAt: 0,
      })
      .run();

    const result = await caller().discover.lists.preview({ provider: "mdblist", listId: "2410" });
    await mdblist.close();

    assert.equal(result.name, "Horror Movies");
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.items.map((i) => [i.title, i.inArr.length]),
      [
        ["Alien", 1],
        ["The Thing", 0],
      ],
    );
  });
});
