/**
 * Against a real HTTP server standing in for TMDb, not a `fetch` stub.
 *
 * The whole value of these two functions is on the wire: which query
 * parameters go out, how a `media_type` the caller can't use is filtered, and
 * how TMDb's title/name and release_date/first_air_date split is normalised. A
 * stub would agree with whatever this file assumed about all three.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { searchMulti, fetchTvExternalIds } from "./search.ts";

interface MockTmdb {
  origin: string;
  /** Full `path?query` of every request, so parameter encoding can be asserted. */
  requests: string[];
  close(): Promise<void>;
}

const MULTI_RESULTS = [
  {
    id: 693134,
    media_type: "movie",
    title: "Dune: Part Two",
    release_date: "2024-02-27",
    overview: "Paul Atreides unites with the Fremen.",
    poster_path: "/dune2.jpg",
    popularity: 812.4,
  },
  {
    id: 87739,
    media_type: "tv",
    name: "The Terminal List",
    first_air_date: "2022-07-01",
    poster_path: null,
  },
  // A person — no title, no year, nothing to add to an *Arr.
  { id: 1190668, media_type: "person", name: "Timothée Chalamet", popularity: 99 },
  // TMDb does emit rows with no title at all.
  { id: 5, media_type: "movie", release_date: "1999-01-01" },
];

function startMockTmdb(): Promise<MockTmdb> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/search/multi") {
      send({ page: Number(url.searchParams.get("page") ?? 1), total_pages: 3, results: MULTI_RESULTS });
      return;
    }
    if (url.pathname === "/tv/87739/external_ids") {
      send({ tvdb_id: 400002, imdb_id: "tt11838438" });
      return;
    }
    // A show TVDb has never carried.
    if (url.pathname === "/tv/1/external_ids") {
      send({ tvdb_id: null });
      return;
    }
    res.writeHead(404).end("{}");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

let tmdb: MockTmdb;
let cfg: { apiKey: string; baseUrl: string };

before(async () => {
  tmdb = await startMockTmdb();
  cfg = { apiKey: "key", baseUrl: tmdb.origin };
});

after(() => tmdb.close());

describe("searchMulti", () => {
  test("keeps films and shows and drops everything else", async () => {
    const page = await searchMulti(cfg, "dune");
    assert.deepEqual(
      page.results.map((r) => r.id),
      [693134, 87739],
    );
  });

  test("normalises the title/name and release_date/first_air_date split", async () => {
    const page = await searchMulti(cfg, "dune");
    const [movie, show] = page.results;
    assert.deepEqual(
      { title: movie.title, year: movie.year, mediaType: movie.mediaType },
      { title: "Dune: Part Two", year: 2024, mediaType: "movie" },
    );
    assert.deepEqual(
      { title: show.title, year: show.year, mediaType: show.mediaType },
      { title: "The Terminal List", year: 2022, mediaType: "tv" },
    );
  });

  test("poster paths stay relative — the caller picks the size", async () => {
    const page = await searchMulti(cfg, "dune");
    assert.equal(page.results[0].posterPath, "/dune2.jpg");
    assert.equal(page.results[1].posterPath, null);
  });

  test("carries the page through", async () => {
    const page = await searchMulti(cfg, "dune", { page: 2 });
    assert.equal(page.page, 2);
    assert.equal(page.totalPages, 3);
    assert.ok(
      tmdb.requests.some((r) => r.includes("page=2")),
      `saw ${tmdb.requests.join(", ")}`,
    );
  });

  test("encodes the query rather than pasting it into the URL", async () => {
    tmdb.requests.length = 0;
    await searchMulti(cfg, "spider-man: no way home & co");
    assert.ok(
      tmdb.requests.some((r) => r.includes("query=spider-man%3A+no+way+home+%26+co")),
      `saw ${tmdb.requests.join(", ")}`,
    );
  });

  test("an empty query costs no request at all", async () => {
    tmdb.requests.length = 0;
    const page = await searchMulti(cfg, "   ");
    assert.deepEqual(page, { page: 1, totalPages: 0, results: [] });
    assert.equal(tmdb.requests.length, 0);
  });

  test("include_adult is off unless asked for", async () => {
    tmdb.requests.length = 0;
    await searchMulti(cfg, "dune");
    assert.ok(tmdb.requests[0].includes("include_adult=false"));
    await searchMulti(cfg, "dune", { includeAdult: true });
    assert.ok(tmdb.requests[1].includes("include_adult=true"));
  });
});

describe("fetchTvExternalIds", () => {
  test("returns the TVDb id Sonarr's lookup needs", async () => {
    assert.deepEqual(await fetchTvExternalIds(cfg, 87739), { tvdbId: 400002, imdbId: "tt11838438" });
  });

  test("a show TMDb has no TVDb mapping for is null, not a throw", async () => {
    assert.deepEqual(await fetchTvExternalIds(cfg, 1), { tvdbId: null, imdbId: null });
  });
});
