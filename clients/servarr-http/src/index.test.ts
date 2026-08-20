import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServarrHttp, ServarrError } from "./index.ts";

/**
 * A mock Servarr app.
 *
 * A real socket rather than a stubbed `fetch`, matching `clients/plex`: the
 * things most worth testing here — the empty-200 body, a 400 with a validation
 * payload, the retry policy — are all properties of the transport, and a stub
 * would be asserting against our own idea of what fetch does.
 */
function createMockServarr() {
  const requests: Array<{
    method: string;
    path: string;
    params: Record<string, string>;
    apiKey?: string;
    body: string;
  }> = [];
  let routes: Record<string, (req: IncomingMessage) => { status: number; body: string }> = {};
  let server: Server;

  function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, "http://localhost");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params: Record<string, string> = {};
      for (const [k, v] of url.searchParams) params[k] = v;
      requests.push({
        method: req.method!,
        path: url.pathname,
        params,
        apiKey: req.headers["x-api-key"] as string | undefined,
        body,
      });
      const route = routes[`${req.method} ${url.pathname}`] ?? routes[url.pathname];
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("[]");
        return;
      }
      const out = route(req);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(out.body);
    });
  }

  return {
    requests,
    route(key: string, fn: (req: IncomingMessage) => { status: number; body: string }) {
      routes[key] = fn;
    },
    start(): Promise<number> {
      server = createServer(handler);
      return new Promise((resolve) => {
        server.listen(0, () => resolve((server.address() as { port: number }).port));
      });
    },
    stop(): Promise<void> {
      routes = {};
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

describe("createServarrHttp", () => {
  let mock: ReturnType<typeof createMockServarr>;
  let port: number;

  beforeEach(async () => {
    mock = createMockServarr();
    port = await mock.start();
  });
  afterEach(() => mock.stop());

  const client = (apiVersion?: string) =>
    createServarrHttp({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "secret", apiVersion });

  it("prefixes the configured api version and sends the key as a header", async () => {
    mock.route("GET /api/v3/movie", () => ({ status: 200, body: "[]" }));
    await client().get("/movie");

    assert.equal(mock.requests[0].path, "/api/v3/movie");
    assert.equal(mock.requests[0].apiKey, "secret");
  });

  it("honours a non-default api version, as Prowlarr needs", async () => {
    mock.route("GET /api/v1/indexer", () => ({ status: 200, body: "[]" }));
    await client("v1").get("/indexer");

    assert.equal(mock.requests[0].path, "/api/v1/indexer");
  });

  it("drops undefined and null params but keeps false and zero", async () => {
    mock.route("GET /api/v3/movie", () => ({ status: 200, body: "[]" }));
    await client().get("/movie", { params: { a: undefined, b: null, c: false, d: 0, e: "x" } });

    assert.deepEqual(mock.requests[0].params, { c: "false", d: "0", e: "x" });
  });

  // The bug this guards is not hypothetical: a DELETE that answers 200 with no
  // body used to throw out of JSON.parse *after* the file was already gone, so
  // the caller saw a failure and retried the delete forever.
  it("treats an empty 200 body as null rather than throwing", async () => {
    mock.route("DELETE /api/v3/movie/1", () => ({ status: 200, body: "" }));
    assert.equal(await client().del("/movie/1"), null);
  });

  it("treats 204 as null", async () => {
    mock.route("DELETE /api/v3/movie/1", () => ({ status: 204, body: "" }));
    assert.equal(await client().del("/movie/1"), null);
  });

  it("parses validation failures out of a 400 body", async () => {
    mock.route("POST /api/v3/movie", () => ({
      status: 400,
      body: JSON.stringify([{ propertyName: "rootFolderPath", errorMessage: "Path does not exist" }]),
    }));

    const err = await client()
      .post("/movie", {})
      .catch((e: unknown) => e);
    assert.ok(err instanceof ServarrError);
    assert.equal(err.status, 400);
    assert.deepEqual(err.failures, [{ field: "rootFolderPath", message: "Path does not exist" }]);
    assert.match(err.message, /rootFolderPath: Path does not exist/);
  });

  it("does not mistake a non-JSON error page for a validation failure", async () => {
    mock.route("POST /api/v3/movie", () => ({ status: 502, body: "<html>Bad Gateway</html>" }));

    const err = await client()
      .post("/movie", {})
      .catch((e: unknown) => e);
    assert.ok(err instanceof ServarrError);
    assert.deepEqual(err.failures, []);
  });

  it("retries a read", async () => {
    let calls = 0;
    mock.route("GET /api/v3/movie", () => {
      calls++;
      return calls < 3 ? { status: 503, body: "" } : { status: 200, body: "[1]" };
    });

    assert.deepEqual(await client().get("/movie"), [1]);
    assert.equal(calls, 3);
  });

  // The whole point of the separate verbs. A retried POST adds the record
  // twice; a retried DELETE duplicates an import-list exclusion, which is a
  // silent "this will never come back" that nobody goes looking for.
  it("never retries a mutation, even on a retryable status", async () => {
    let calls = 0;
    mock.route("POST /api/v3/movie", () => {
      calls++;
      return { status: 503, body: "" };
    });

    await client()
      .post("/movie", {})
      .catch(() => {});
    assert.equal(calls, 1);
  });

  it("raw() returns the failing status instead of throwing, for the add path", async () => {
    mock.route("POST /api/v3/movie", () => ({
      status: 400,
      body: JSON.stringify([{ errorMessage: "This movie has already been added" }]),
    }));

    const res = await client().raw("POST", "/movie", {});
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.body, /already been added/);
  });

  describe("health reporting", () => {
    it("reports healthy on a successful call", async () => {
      mock.route("GET /api/v3/movie", () => ({ status: 200, body: "[]" }));
      const seen: Array<{ ok: boolean }> = [];
      await createServarrHttp({
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "k",
        onHealth: (ok, error) => seen.push({ ok, ...(error ? { error } : {}) }),
      }).get("/movie");

      assert.deepEqual(seen, [{ ok: true }]);
    });

    // A 4xx means we reached the app and it disagreed with us. Reporting that
    // as unreachable would light up the health page every time somebody
    // submitted a bad form.
    it("does not report a 4xx as unhealthy", async () => {
      mock.route("POST /api/v3/movie", () => ({ status: 400, body: "[]" }));
      const seen: boolean[] = [];
      await createServarrHttp({
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "k",
        onHealth: (ok) => seen.push(ok),
      })
        .post("/movie", {})
        .catch(() => {});

      assert.deepEqual(seen, []);
    });

    it("reports a 5xx as unhealthy", async () => {
      mock.route("GET /api/v3/movie", () => ({ status: 500, body: "" }));
      const seen: boolean[] = [];
      await createServarrHttp({
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "k",
        onHealth: (ok) => seen.push(ok),
      })
        .get("/movie", { retries: 0 })
        .catch(() => {});

      assert.deepEqual(seen, [false]);
    });
  });
});
