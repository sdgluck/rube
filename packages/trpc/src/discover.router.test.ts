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
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken } from "@tinkerbell/core";
import { DbToken, arrMovies } from "@tinkerbell/db";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { startMockRadarr, type MockArr } from "@tinkerbell/test-support";
import { createTrpc } from "./index.ts";
import type { AdminContext } from "./_base.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const services = c.resolve(ServicesToken);
const { appRouter } = createTrpc({ ...services, jobs: c.resolve(JobsToken) });

function caller() {
  const ctx = {
    session: undefined,
    resHeaders: new Headers(),
    secure: false,
    origin: "http://admin.tinkerbell.test",
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
  });

  /**
   * The page needs this so it can render a "configure TMDb" prompt *instead of*
   * searching. Learning the key is missing by firing a doomed search is a
   * wasted request and an error state standing in for a setup step.
   */
  test("reports what is configured without touching the network", async () => {
    assert.deepEqual(await caller().discover.status(), { tmdb: false, radarr: false, sonarr: false });
    setConfig("global_tmdb_api_key", "k");
    await useRadarr();
    assert.deepEqual(await caller().discover.status(), { tmdb: true, radarr: true, sonarr: false });
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
