/**
 * Pagination, and the two ways it ends.
 *
 * `iterSeerrRequests` is a `while (true)` loop with two exits: `skip >=
 * pageInfo.results`, and an empty page. Neither had a test, and both failure
 * modes are silent — an infinite loop wedges the job queue (nothing else runs
 * behind it), and an early return truncates the collection to whatever the
 * first page happened to hold. Neither reports an error; the user sees "the
 * job never finished" or "the collection is smaller than my Seerr list".
 *
 * The second exit exists because the first is not enough: a server whose
 * `pageInfo.results` overstates what it will actually return would loop for
 * ever on the first count alone. That belt-and-braces pair is the whole point
 * of the function and is what most of this file exercises.
 *
 * Real HTTP against a real server, since the client takes its base URL as an
 * argument — so URL construction, header placement and query encoding are all
 * under test rather than assumed.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";

import { fetchSeerrRequests, iterSeerrRequests, testSeerrConnection } from "./index.ts";

let server: Server;
let base: string;
let requests: Array<{ path: string; apiKey: string | undefined }> = [];
let handler: (url: URL, res: ServerResponse) => void;

/** A request as Seerr shapes it. */
const request = (id: number) => ({
  id,
  media: { tmdbId: 1000 + id, mediaType: "movie", status: 5 },
  requestedBy: { username: "sam" },
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** A server holding `total` requests, paginating honestly. */
function paginating(total: number, opts: { reportedResults?: number } = {}) {
  return (url: URL, res: ServerResponse) => {
    const take = Number(url.searchParams.get("take") ?? 20);
    const skip = Number(url.searchParams.get("skip") ?? 0);
    const results = Array.from({ length: Math.max(0, Math.min(take, total - skip)) }, (_, i) => request(skip + i + 1));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        pageInfo: { pages: Math.ceil(total / take), pageSize: take, results: opts.reportedResults ?? total, page: 1 },
        results,
      }),
    );
  };
}

before(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://mock");
    requests.push({ path: `${url.pathname}${url.search}`, apiKey: req.headers["x-api-key"] as string | undefined });
    handler(url, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

beforeEach(() => {
  requests = [];
  handler = paginating(0);
});

const opts = () => ({ url: base, apiKey: "seerr-key" });

describe("fetchSeerrRequests", () => {
  test("returns everything when there is less than a page", async () => {
    handler = paginating(5);
    const all = await fetchSeerrRequests(opts());
    assert.equal(all.length, 5);
    assert.deepEqual(
      all.map((r) => r.id),
      [1, 2, 3, 4, 5],
    );
  });

  test("walks several pages", async () => {
    handler = paginating(45);
    const all = await fetchSeerrRequests({ ...opts(), limit: 100 });
    assert.equal(all.length, 45);
    assert.equal(requests.length, 3, "20 + 20 + 5");
  });

  test("stops at `limit` rather than draining the server", async () => {
    // The rule asks for as many as it needs. Draining a Seerr with thousands of
    // requests to fill a collection of 50 is the difference between a job that
    // finishes and one that doesn't.
    handler = paginating(1_000);
    const all = await fetchSeerrRequests({ ...opts(), limit: 25 });

    assert.equal(all.length, 25);
    assert.ok(requests.length <= 2, `stopped after ${requests.length} pages`);
  });

  test("an empty Seerr returns nothing after exactly one request", async () => {
    handler = paginating(0);
    assert.deepEqual(await fetchSeerrRequests(opts()), []);
    assert.equal(requests.length, 1);
  });

  test("the limit is respected exactly at the page boundary", async () => {
    handler = paginating(100);
    assert.equal((await fetchSeerrRequests({ ...opts(), limit: 20 })).length, 20);
    assert.equal((await fetchSeerrRequests({ ...opts(), limit: 21 })).length, 21);
  });
});

describe("pagination termination", () => {
  test("terminates when skip passes the reported total", async () => {
    handler = paginating(30);
    const seen: number[] = [];
    for await (const r of iterSeerrRequests(opts())) seen.push(r.id);
    assert.equal(seen.length, 30);
  });

  test("terminates on an empty page even when the total says otherwise", async () => {
    // The second exit, and the one that stops a wedged job queue. A Seerr that
    // reports 500 results but returns nothing after the first page would loop
    // for ever on the count alone.
    handler = paginating(20, { reportedResults: 500 });

    const seen: number[] = [];
    for await (const r of iterSeerrRequests(opts())) seen.push(r.id);

    assert.equal(seen.length, 20);
    assert.ok(requests.length < 10, `gave up after ${requests.length} pages rather than looping`);
  });

  test("terminates when the very first page is empty but the total is not zero", async () => {
    handler = (_url, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pageInfo: { pages: 9, pageSize: 20, results: 180, page: 1 }, results: [] }));
    };

    const seen: unknown[] = [];
    for await (const r of iterSeerrRequests(opts())) seen.push(r);

    assert.deepEqual(seen, []);
    assert.equal(requests.length, 1);
  });

  test("does not stop early when a page is full but the total is larger", async () => {
    handler = paginating(41);
    const seen: number[] = [];
    for await (const r of iterSeerrRequests(opts())) seen.push(r.id);
    assert.equal(seen.length, 41, "the tail page was not dropped");
  });
});

describe("the request itself", () => {
  test("addresses /api/v1/request with take and skip", async () => {
    handler = paginating(25);
    await fetchSeerrRequests({ ...opts(), limit: 100 });

    assert.match(requests[0]!.path, /^\/api\/v1\/request\?/);
    const params = new URL(requests[0]!.path, "http://mock").searchParams;
    assert.equal(params.get("take"), "20");
    assert.equal(params.get("skip"), "0");
    assert.equal(new URL(requests[1]!.path, "http://mock").searchParams.get("skip"), "20");
  });

  test("sends the api key as a header, not a query parameter", async () => {
    // Keeps it out of the Seerr access log.
    handler = paginating(1);
    await fetchSeerrRequests(opts());

    assert.equal(requests[0]!.apiKey, "seerr-key");
    assert.doesNotMatch(requests[0]!.path, /seerr-key/);
  });

  test("a filter is passed through, and `all` is omitted", async () => {
    // `filter=all` is not a value Seerr knows; sending it would filter to
    // nothing rather than to everything.
    handler = paginating(1);

    await fetchSeerrRequests({ ...opts(), filter: "approved" });
    assert.equal(new URL(requests[0]!.path, "http://mock").searchParams.get("filter"), "approved");

    requests = [];
    await fetchSeerrRequests({ ...opts(), filter: "all" });
    assert.equal(new URL(requests[0]!.path, "http://mock").searchParams.get("filter"), null);
  });

  test("a base URL with a path prefix still resolves to the API root", async () => {
    // `new URL("/api/v1/request", base)` is absolute, so a reverse-proxied
    // Seerr under a subpath resolves to the host root. Documented so somebody
    // hitting it knows it is the URL construction, not their config.
    handler = paginating(1);
    await fetchSeerrRequests({ ...opts(), url: `${base}/seerr/` });
    assert.match(requests[0]!.path, /^\/api\/v1\/request/);
  });
});

describe("errors", () => {
  test("an API error names Seerr", async () => {
    handler = (_url, res) => {
      res.writeHead(401);
      res.end("Unauthorized");
    };

    await assert.rejects(() => fetchSeerrRequests(opts()), /Seerr API error/);
  });

  test("a read is retried, so a blip does not fail a whole run", async () => {
    let hit = 0;
    handler = (url, res) => {
      if (++hit < 3) {
        res.writeHead(503);
        return res.end();
      }
      paginating(2)(url, res);
    };

    const all = await fetchSeerrRequests(opts());
    assert.equal(all.length, 2);
  });
});

describe("testSeerrConnection", () => {
  test("reports the counts", async () => {
    handler = (_url, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ total: 12, movie: 8, tv: 4 }));
    };

    assert.deepEqual(await testSeerrConnection(base, "k"), { total: 12, movie: 8, tv: 4 });
  });

  test("missing counts read as zero rather than undefined", async () => {
    handler = (_url, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
    };

    assert.deepEqual(await testSeerrConnection(base, "k"), { total: 0, movie: 0, tv: 0 });
  });

  test("is NOT retried — a Test button should answer, right or wrong", async () => {
    // The asymmetry with the paging call is deliberate: somebody is watching
    // this one, and three backoffs later is not an answer.
    let hit = 0;
    handler = (_url, res) => {
      hit++;
      res.writeHead(503);
      res.end();
    };

    await assert.rejects(() => testSeerrConnection(base, "k"), /Seerr API error/);
    assert.equal(hit, 1);
  });

  test("addresses the count endpoint", async () => {
    handler = (_url, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    };

    await testSeerrConnection(base, "k");
    assert.equal(requests[0]!.path, "/api/v1/request/count");
  });
});
