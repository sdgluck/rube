/**
 * Ratings that feed overlay badges and rating-threshold rules.
 *
 * Two things make a bug here quiet. First, a wrong rating is still a rating —
 * a badge saying 6.9 where it should say 8.1 looks entirely normal, and a
 * `minImdb` rule silently excludes the wrong films. Second, everything is
 * cached: a present rating never expires, so a value written wrongly once is
 * wrong for ever, and re-running the job will not fix it. (Only a *missing*
 * Rotten Tomatoes score is re-asked, after `MISSING_RT_RECHECK_MS`.)
 *
 * The cache short-circuit is therefore the most important behaviour here, in
 * both directions — it must be consulted *before* the API key check (so a cache
 * hit works on an install with no key at all), and a `Response: "False"` must
 * not be cached (or a title OMDb didn't know about yesterday is permanently
 * unknown).
 *
 * The endpoint is hardcoded to `omdbapi.com` with no injectable base, so this
 * stubs `globalThis.fetch` rather than standing up a server — the one case in
 * this sweep where the wire itself cannot be exercised.
 */
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";

import { createTestContainer } from "@rube/composition/test-support";
import { DbToken, omdbCache } from "@rube/db";

import { eq } from "drizzle-orm";
import { createOmdbClient, extractImdbId, MISSING_RT_RECHECK_MS } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());
const db = c.resolve(DbToken);

const realFetch = globalThis.fetch;
let calls: string[] = [];
let respond: () => Response;

beforeEach(() => {
  db.delete(omdbCache).run();
  calls = [];
  respond = () => Response.json({ Response: "True", imdbRating: "8.1", Ratings: [] });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const client = (over: { apiKey?: string | null; onHealth?: Parameters<typeof createOmdbClient>[0]["onHealth"] } = {}) =>
  createOmdbClient({ apiKey: "omdb-key", db, ...over });

describe("extractImdbId", () => {
  test("finds an imdb guid among the others", () => {
    assert.equal(extractImdbId(["tmdb://12345", "imdb://tt1856101", "tvdb://999"]), "tt1856101");
  });

  test("takes the first imdb guid when there are several", () => {
    assert.equal(extractImdbId(["imdb://tt1", "imdb://tt2"]), "tt1");
  });

  test("is null when there is no imdb guid", () => {
    assert.equal(extractImdbId(["tmdb://12345"]), null);
    assert.equal(extractImdbId([]), null);
  });

  test("ignores a guid that merely mentions imdb", () => {
    // `plex://movie/imdb-ish` is not an imdb id, and treating it as one sends
    // a malformed lookup that is then cached as a miss.
    assert.equal(extractImdbId(["plex://movie/imdb-ish", "https://imdb.com/title/tt1"]), null);
  });
});

describe("the cache", () => {
  test("a miss calls the API and writes the result", async () => {
    respond = () => Response.json({ Response: "True", imdbRating: "8.1", Ratings: [] });

    const first = await client().getRatings("tt1");

    assert.equal(first?.source, "api");
    assert.equal(first?.imdbRating, "8.1");
    assert.equal(db.select().from(omdbCache).all().length, 1);
  });

  test("a second lookup is served from the cache without another request", async () => {
    await client().getRatings("tt1");
    calls = [];

    const second = await client().getRatings("tt1");

    assert.equal(second?.source, "cache");
    assert.equal(second?.imdbRating, "8.1");
    assert.deepEqual(calls, [], "no second request");
  });

  test("the cache is consulted before the API key, so a keyless install still reads it", async () => {
    // The ordering matters: an install that had a key, cached a library's worth
    // of ratings and then removed the key must keep its badges.
    await client().getRatings("tt1");
    calls = [];

    const keyless = await client({ apiKey: null }).getRatings("tt1");

    assert.equal(keyless?.source, "cache");
    assert.deepEqual(calls, []);
  });

  test("with no key and no cache entry, the answer is null rather than a request", async () => {
    assert.equal(await client({ apiKey: null }).getRatings("tt-unknown"), null);
    assert.deepEqual(calls, []);
  });

  test("a `Response: False` is not cached", async () => {
    // OMDb answers 200 with `Response: "False"` for a title it doesn't know.
    // Caching that would make a film permanently unrated even after OMDb adds
    // it — and there is no TTL to recover from.
    respond = () => Response.json({ Response: "False", Error: "Movie not found!" });

    assert.equal(await client().getRatings("tt-unknown"), null);
    assert.equal(db.select().from(omdbCache).all().length, 0);
  });

  test("a failed request is not cached either", async () => {
    respond = () => new Response("nope", { status: 500 });

    assert.equal(await client().getRatings("tt1"), null);
    assert.equal(db.select().from(omdbCache).all().length, 0);
  });
});

describe("rating extraction", () => {
  test("pulls Rotten Tomatoes out of the Ratings array", async () => {
    respond = () =>
      Response.json({
        Response: "True",
        imdbRating: "8.1",
        Ratings: [
          { Source: "Internet Movie Database", Value: "8.1/10" },
          { Source: "Rotten Tomatoes", Value: "92%" },
          { Source: "Metacritic", Value: "81/100" },
        ],
      });

    const ratings = await client().getRatings("tt1");
    assert.equal(ratings?.rtRating, "92%");
    assert.equal(ratings?.imdbRating, "8.1", "the top-level field, not the Ratings entry");
  });

  test("`N/A` becomes null rather than a badge reading N/A", async () => {
    respond = () => Response.json({ Response: "True", imdbRating: "N/A", Ratings: [] });

    const ratings = await client().getRatings("tt1");
    assert.equal(ratings?.imdbRating, null);
  });

  test("a missing rating is null", async () => {
    respond = () => Response.json({ Response: "True", Ratings: [] });
    assert.equal((await client().getRatings("tt1"))?.imdbRating, null);
  });

  test("no Rotten Tomatoes entry is null, not the first rating that happened to be there", async () => {
    // Taking `Ratings[0]` would put Metacritic's 81/100 into an RT badge.
    respond = () =>
      Response.json({
        Response: "True",
        imdbRating: "8.1",
        Ratings: [{ Source: "Metacritic", Value: "81/100" }],
      });

    assert.equal((await client().getRatings("tt1"))?.rtRating, null);
  });

  test("a non-array Ratings field does not throw", async () => {
    respond = () => Response.json({ Response: "True", imdbRating: "8.1", Ratings: null });
    assert.equal((await client().getRatings("tt1"))?.rtRating, null);
  });

  test("nulls are cached, so a rating-less title is not re-fetched every run", async () => {
    respond = () => Response.json({ Response: "True", imdbRating: "N/A", Ratings: [] });
    await client().getRatings("tt1");
    calls = [];

    const second = await client().getRatings("tt1");
    assert.equal(second?.source, "cache");
    assert.deepEqual(calls, []);
  });

  test("a missing Rotten Tomatoes score is asked again once it is a month old", async () => {
    respond = () => Response.json({ Response: "True", imdbRating: "7.0", Ratings: [] });
    await client().getRatings("tt1");
    db.update(omdbCache)
      .set({ fetchedAt: Date.now() - MISSING_RT_RECHECK_MS - 1 })
      .where(eq(omdbCache.imdbId, "tt1"))
      .run();

    respond = () =>
      Response.json({ Response: "True", imdbRating: "7.0", Ratings: [{ Source: "Rotten Tomatoes", Value: "91%" }] });
    calls = [];
    const again = await client().getRatings("tt1");
    assert.equal(again?.source, "api");
    assert.equal(again?.rtRating, "91%");
    assert.equal(calls.length, 1);
    assert.equal(db.select().from(omdbCache).get()?.rtRating, "91%");
  });

  test("a present score never expires", async () => {
    respond = () =>
      Response.json({ Response: "True", imdbRating: "7.0", Ratings: [{ Source: "Rotten Tomatoes", Value: "91%" }] });
    await client().getRatings("tt1");
    db.update(omdbCache).set({ fetchedAt: 0 }).run();
    calls = [];
    assert.equal((await client().getRatings("tt1"))?.source, "cache");
    assert.deepEqual(calls, []);
  });

  test("a stale entry is still served on an install with no key", async () => {
    respond = () => Response.json({ Response: "True", imdbRating: "7.0", Ratings: [] });
    await client().getRatings("tt1");
    db.update(omdbCache).set({ fetchedAt: 0 }).run();
    calls = [];
    assert.equal((await client({ apiKey: null }).getRatings("tt1"))?.source, "cache");
    assert.deepEqual(calls, []);
  });
});

describe("the request", () => {
  test("sends the imdb id and the key as query parameters", async () => {
    // OMDb has no header alternative; the point of the assertion is that the
    // URL is built with `URL`, so an id with odd characters is encoded rather
    // than concatenated.
    await client().getRatings("tt1856101");

    const url = new URL(calls[0]!);
    assert.equal(url.origin + url.pathname, "https://www.omdbapi.com/");
    assert.equal(url.searchParams.get("i"), "tt1856101");
    assert.equal(url.searchParams.get("apikey"), "omdb-key");
  });

  test("an id with URL-significant characters is encoded", async () => {
    await client().getRatings("tt1&apikey=stolen");
    const url = new URL(calls[0]!);
    assert.equal(url.searchParams.get("i"), "tt1&apikey=stolen");
    assert.equal(url.searchParams.get("apikey"), "omdb-key", "the key was not overridden by the id");
  });
});

describe("health reporting", () => {
  test("a success is reported without the key in the message", async () => {
    const events: Array<{ status: string; message: string }> = [];
    await client({ onHealth: (status, message) => events.push({ status, message }) }).getRatings("tt1");

    assert.equal(events.at(-1)?.status, "ok");
    assert.doesNotMatch(events.at(-1)?.message ?? "", /omdb-key/, "the api key leaked into a health message");
  });

  test("an HTTP error is reported as an error", async () => {
    respond = () => new Response("nope", { status: 401 });
    const events: Array<{ status: string; message: string }> = [];

    await client({ onHealth: (status, message) => events.push({ status, message }) }).getRatings("tt1");

    assert.equal(events.at(-1)?.status, "error");
    assert.match(events.at(-1)?.message ?? "", /401/);
  });

  test("a transport failure is reported as an error too", async () => {
    respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const events: Array<{ status: string; message: string }> = [];

    assert.equal(
      await client({ onHealth: (status, message) => events.push({ status, message }) }).getRatings("tt1"),
      null,
    );
    assert.equal(events.at(-1)?.status, "error");
  });

  test("OMDb's own refusal (request limit, bad key) is reported, not swallowed", async () => {
    const reports: Array<[string, string]> = [];
    respond = () => Response.json({ Response: "False", Error: "Request limit reached!" });
    assert.equal(await client({ onHealth: (s, m) => reports.push([s, m]) }).getRatings("tt1"), null);
    assert.deepEqual(reports.at(-1), ["error", "OMDb: Request limit reached!"]);
  });

  test("an unknown title is not an error", async () => {
    const reports: Array<[string, string]> = [];
    respond = () => Response.json({ Response: "False", Error: "Movie not found!" });
    await client({ onHealth: (s, m) => reports.push([s, m]) }).getRatings("tt1");
    assert.ok(reports.every(([status]) => status === "ok"));
  });

  test("a cache hit reports nothing — it did not talk to anyone", async () => {
    await client().getRatings("tt1");

    const events: string[] = [];
    await client({ onHealth: (status) => events.push(status) }).getRatings("tt1");

    assert.deepEqual(events, [], "a cache hit is not evidence that OMDb is up");
  });
});
