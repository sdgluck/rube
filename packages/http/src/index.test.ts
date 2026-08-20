/**
 * Every outbound client in the workspace routes through `httpRequest`, and
 * none of its guarantees were tested. The ones that matter are all about what
 * happens when the far end misbehaves:
 *
 * - **A retry must not duplicate a mutation.** Callers control this by passing
 *   `retries: 0` for non-GET requests, so the property to pin here is that
 *   `retries` is honoured exactly — n retries means n+1 attempts, never n+2.
 * - **`Retry-After` must beat the local backoff.** Guessing with exponential
 *   backoff when the server has told us how long to wait is how one 429 becomes
 *   several.
 * - **The error body must be truncated.** An *Arr that answers a 500 with an
 *   HTML page would otherwise put the whole page into a job log and a
 *   notification.
 * - **A timeout must actually fire**, and must compose with a caller's own
 *   signal rather than replacing it.
 *
 * Real HTTP against a real server on port 0 rather than a `fetch` stub, for the
 * reason the mock servers in `packages/jobs` give: a stub agrees with you about
 * what was sent. Here the assertions are about what the server *received*.
 *
 * `retryDelayMs: () => 0` throughout — the real backoff starts at a second, and
 * a test that costs three seconds to assert two retries is a test nobody runs.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { HttpError, httpRequest, httpRequestJson } from "./index.ts";

// `unknown` rather than `void`, so a handler can `return res.end()` — which
// reads better than a bare `res.end(); return;` at every early exit.
type Handler = (req: IncomingMessage, res: ServerResponse, hit: number) => unknown;

let server: Server;
let base: string;
/** Every request the server saw, in order. */
let log: { method: string; url: string }[] = [];
let handler: Handler = (_req, res) => res.end("ok");

/** Swap the handler for one test, and reset the request log. */
function serve(next: Handler): void {
  log = [];
  handler = next;
}

const NO_BACKOFF = () => 0;

before(async () => {
  server = createServer((req, res) => {
    log.push({ method: req.method ?? "", url: req.url ?? "" });
    void Promise.resolve(handler(req, res, log.length)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

describe("the happy path", () => {
  test("returns the raw Response so a non-JSON caller can read bytes", async () => {
    serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from([1, 2, 3]));
    });

    const res = await httpRequest({ url: `${base}/poster.png` });
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  });

  test("passes method, headers and body through", async () => {
    let seen: { method?: string; auth?: string; body?: string } = {};
    serve(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      seen = {
        method: req.method,
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      };
      res.end("{}");
    });

    await httpRequest({
      url: `${base}/x`,
      init: { method: "PUT", headers: { authorization: "Bearer t" }, body: '{"a":1}' },
    });

    assert.deepEqual(seen, { method: "PUT", auth: "Bearer t", body: '{"a":1}' });
  });

  test("httpRequestJson parses the body", async () => {
    serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"page":2}');
    });

    assert.deepEqual(await httpRequestJson<{ page: number }>({ url: `${base}/x` }), { page: 2 });
  });

  test("does not retry a request that succeeded", async () => {
    serve((_req, res) => res.end("ok"));
    await httpRequest({ url: `${base}/x`, retries: 3, retryDelayMs: NO_BACKOFF });
    assert.equal(log.length, 1);
  });
});

describe("errors", () => {
  test("a non-retryable status throws HttpError carrying status and body", async () => {
    serve((_req, res) => {
      res.writeHead(404);
      res.end("no such movie");
    });

    const err = await httpRequest({ url: `${base}/x` }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 404);
    assert.equal(err.body, "no such movie");
    assert.match(err.message, /404 .* — no such movie/);
    assert.equal(err.name, "HttpError");
  });

  test("the error body is truncated to `errorBodyMaxLen`", async () => {
    // An *Arr answering a 500 with an HTML error page would otherwise put the
    // whole page into a job log and a notification.
    serve((_req, res) => {
      res.writeHead(500);
      res.end("x".repeat(5_000));
    });

    const short = await httpRequest({ url: `${base}/x`, errorBodyMaxLen: 10 }).then(
      () => null,
      (e: unknown) => e as HttpError,
    );
    assert.equal(short?.body.length, 10);

    const dflt = await httpRequest({ url: `${base}/x` }).then(
      () => null,
      (e: unknown) => e as HttpError,
    );
    assert.equal(dflt?.body.length, 200, "the default cap is 200");
  });

  test("an empty error body leaves the message readable", async () => {
    serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });

    const err = await httpRequest({ url: `${base}/x` }).then(
      () => null,
      (e: unknown) => e as HttpError,
    );
    assert.equal(err?.body, "");
    assert.doesNotMatch(err?.message ?? "", /—\s*$/, "no dangling em dash when there is no body");
  });

  test("a connection refused propagates rather than becoming an HttpError", async () => {
    // The caller distinguishes "the service said no" from "the service isn't
    // there"; collapsing both into HttpError would lose that.
    const err = await httpRequest({ url: "http://127.0.0.1:1/x", timeoutMs: 2_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof HttpError));
  });
});

describe("retries", () => {
  test("n retries means exactly n+1 attempts", async () => {
    serve((_req, res) => {
      res.writeHead(503);
      res.end("busy");
    });

    await assert.rejects(() => httpRequest({ url: `${base}/x`, retries: 2, retryDelayMs: NO_BACKOFF }), HttpError);
    assert.equal(log.length, 3, "one attempt plus two retries");
  });

  test("retries: 0 means one attempt — the guard against a duplicated mutation", async () => {
    // This is what every non-GET caller relies on. A retried DELETE that
    // actually landed the first time deletes twice.
    serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });

    await assert.rejects(() => httpRequest({ url: `${base}/x`, init: { method: "DELETE" }, retries: 0 }), HttpError);
    assert.equal(log.length, 1);
    assert.deepEqual(log[0], { method: "DELETE", url: "/x" });
  });

  test("a retry that succeeds returns the successful response", async () => {
    serve((_req, res, hit) => {
      if (hit < 3) {
        res.writeHead(503);
        return res.end();
      }
      res.end("finally");
    });

    const res = await httpRequest({ url: `${base}/x`, retries: 3, retryDelayMs: NO_BACKOFF });
    assert.equal(await res.text(), "finally");
    assert.equal(log.length, 3);
  });

  test("only the configured statuses are retried", async () => {
    serve((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    // 404 is not in the default retryable set, so the retries are not spent.
    await assert.rejects(() => httpRequest({ url: `${base}/x`, retries: 5, retryDelayMs: NO_BACKOFF }), HttpError);
    assert.equal(log.length, 1);
  });

  test("`retryOn` replaces the default set rather than adding to it", async () => {
    serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });

    await assert.rejects(
      () => httpRequest({ url: `${base}/x`, retries: 2, retryOn: new Set([404]), retryDelayMs: NO_BACKOFF }),
      HttpError,
    );
    assert.equal(log.length, 1, "503 is no longer retryable once the set is overridden");
  });

  test("each of the default retryable statuses is retried", async () => {
    for (const status of [429, 502, 503, 504]) {
      serve((_req, res) => {
        res.writeHead(status);
        res.end();
      });
      await assert.rejects(() => httpRequest({ url: `${base}/x`, retries: 1, retryDelayMs: NO_BACKOFF }), HttpError);
      assert.equal(log.length, 2, `${status} should have been retried`);
    }
  });

  test("a network error is retried too", async () => {
    // `destroy()` before a response is a transport failure, not a status.
    serve((req, res, hit) => {
      if (hit < 2) return req.destroy();
      res.end("ok");
    });

    const res = await httpRequest({ url: `${base}/x`, retries: 2, retryDelayMs: NO_BACKOFF });
    assert.equal(await res.text(), "ok");
  });

  test("the backoff is consulted once per retry, with the attempt index", async () => {
    const attempts: number[] = [];
    serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });

    await assert.rejects(() =>
      httpRequest({
        url: `${base}/x`,
        retries: 3,
        retryDelayMs: (attempt) => {
          attempts.push(attempt);
          return 0;
        },
      }),
    );
    assert.deepEqual(attempts, [0, 1, 2], "0-based, and not called after the last attempt");
  });
});

describe("Retry-After", () => {
  test("a delta-seconds header is honoured instead of the local backoff", async () => {
    let localBackoffUsed = false;
    serve((_req, res, hit) => {
      if (hit === 1) {
        res.writeHead(429, { "Retry-After": "0" });
        return res.end();
      }
      res.end("ok");
    });

    // `Retry-After: 0` is not a positive delay, so it is ignored and the local
    // backoff runs — the boundary is worth stating explicitly.
    await httpRequest({
      url: `${base}/x`,
      retries: 1,
      retryDelayMs: () => {
        localBackoffUsed = true;
        return 0;
      },
    });
    assert.equal(localBackoffUsed, true, "a non-positive Retry-After falls back to the local backoff");
  });

  test("a positive delta-seconds header suppresses the local backoff", async () => {
    let localBackoffUsed = false;
    serve((_req, res, hit) => {
      if (hit === 1) {
        // 0.05s: honoured, and short enough not to slow the suite.
        res.writeHead(429, { "Retry-After": "0.05" });
        return res.end();
      }
      res.end("ok");
    });

    const started = performance.now();
    await httpRequest({
      url: `${base}/x`,
      retries: 1,
      retryDelayMs: () => {
        localBackoffUsed = true;
        return 0;
      },
    });

    assert.equal(localBackoffUsed, false, "the server's answer beat the guess");
    assert.ok(performance.now() - started >= 40, "and it actually waited");
  });

  test("an HTTP-date header is understood", async () => {
    // `toUTCString()` has one-second granularity, so the delta has to be over a
    // second to survive the round trip — anything smaller parses to a wait in
    // the past and is (correctly) ignored, which would make this test pass for
    // the wrong reason.
    let localBackoffUsed = false;
    serve((_req, res, hit) => {
      if (hit === 1) {
        res.writeHead(503, { "Retry-After": new Date(Date.now() + 1_500).toUTCString() });
        return res.end();
      }
      res.end("ok");
    });

    const started = performance.now();
    await httpRequest({
      url: `${base}/x`,
      retries: 1,
      retryDelayMs: () => {
        localBackoffUsed = true;
        return 0;
      },
    });

    assert.equal(localBackoffUsed, false, "the date was parsed, so the local guess was not needed");
    assert.ok(performance.now() - started >= 500, "and it waited rather than retrying immediately");
  });

  test("a date in the past is ignored rather than treated as a negative wait", async () => {
    let localBackoffUsed = false;
    serve((_req, res, hit) => {
      if (hit === 1) {
        res.writeHead(503, { "Retry-After": new Date(Date.now() - 60_000).toUTCString() });
        return res.end();
      }
      res.end("ok");
    });

    await httpRequest({
      url: `${base}/x`,
      retries: 1,
      retryDelayMs: () => {
        localBackoffUsed = true;
        return 0;
      },
    });
    assert.equal(localBackoffUsed, true);
  });

  test("nonsense in the header falls back to the local backoff", async () => {
    let localBackoffUsed = false;
    serve((_req, res, hit) => {
      if (hit === 1) {
        res.writeHead(503, { "Retry-After": "soon" });
        return res.end();
      }
      res.end("ok");
    });

    await httpRequest({
      url: `${base}/x`,
      retries: 1,
      retryDelayMs: () => {
        localBackoffUsed = true;
        return 0;
      },
    });
    assert.equal(localBackoffUsed, true);
  });

  test("the response body is drained before a retry", async () => {
    // Undrained bodies hold the connection open; with keep-alive that leaks a
    // socket per retry.
    let finished = false;
    serve((_req, res, hit) => {
      if (hit === 1) {
        res.writeHead(503);
        res.on("finish", () => {
          finished = true;
        });
        return res.end("busy".repeat(1000));
      }
      res.end("ok");
    });

    await httpRequest({ url: `${base}/x`, retries: 1, retryDelayMs: NO_BACKOFF });
    assert.equal(finished, true);
  });
});

describe("timeouts and cancellation", () => {
  test("a slow response is aborted at `timeoutMs`", async () => {
    serve(async (_req, res) => {
      await delay(2_000);
      res.end("late");
    });

    const started = performance.now();
    await assert.rejects(
      () => httpRequest({ url: `${base}/slow`, timeoutMs: 100 }),
      (err: unknown) => (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError",
    );
    assert.ok(performance.now() - started < 1_500, "it did not wait for the response");
  });

  test("each retry gets a fresh deadline rather than sharing one", async () => {
    // A single shared `AbortSignal.timeout` would make the second attempt
    // inherit whatever was left of the first one's budget, so a service that is
    // merely slow could never be retried successfully.
    serve(async (_req, res, hit) => {
      if (hit === 1) {
        await delay(200);
        return res.end("late");
      }
      res.end("ok");
    });

    const res = await httpRequest({ url: `${base}/x`, timeoutMs: 120, retries: 1, retryDelayMs: NO_BACKOFF });
    assert.equal(await res.text(), "ok");
  });

  test("a caller's own signal still aborts — the timeout stacks, it does not replace", async () => {
    serve(async (_req, res) => {
      await delay(2_000);
      res.end("late");
    });

    const controller = new AbortController();
    const pending = httpRequest({ url: `${base}/slow`, timeoutMs: 30_000, init: { signal: controller.signal } });
    controller.abort(new Error("caller changed their mind"));

    await assert.rejects(() => pending, /caller changed their mind/);
  });

  test("aborting during the backoff stops the retry rather than waiting it out", async () => {
    // The sleep between attempts takes the caller's signal for exactly this:
    // a cancelled job should not sit in a backoff for ten seconds first.
    serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });

    const backoffCalls: number[] = [];
    const controller = new AbortController();
    const pending = httpRequest({
      url: `${base}/x`,
      retries: 5,
      retryDelayMs: (attempt) => {
        backoffCalls.push(attempt);
        return 5_000;
      },
      init: { signal: controller.signal },
    });

    await delay(50);
    controller.abort(new Error("cancelled"));

    const started = performance.now();
    await assert.rejects(() => pending, /cancelled/);
    assert.ok(performance.now() - started < 1_000, "it did not wait out the 5s backoff");
    // Asserted on the backoff rather than on the server's request count:
    // undici transparently re-sends an idempotent request when it picks a
    // pooled connection the peer has already closed, so the server can see two
    // requests for one attempt. The number of *attempts* is what this is about,
    // and the backoff is consulted exactly once per retry.
    assert.deepEqual(backoffCalls, [0], "it did not go round again");
  });
});
