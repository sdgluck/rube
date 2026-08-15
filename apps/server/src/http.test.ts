import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { guarded, isClientDisconnect, sendFetchResponse } from "./http.ts";

describe("isClientDisconnect", () => {
  test("recognises the codes a departed client produces", () => {
    for (const code of [
      "ERR_STREAM_UNABLE_TO_PIPE",
      "ERR_STREAM_PREMATURE_CLOSE",
      "ERR_STREAM_WRITE_AFTER_END",
      "ECONNRESET",
      "EPIPE",
    ]) {
      assert.equal(isClientDisconnect(Object.assign(new Error("x"), { code })), true, code);
    }
  });

  test("a genuine fault is not a disconnect", () => {
    assert.equal(isClientDisconnect(new Error("rule evaluation failed")), false);
    assert.equal(isClientDisconnect(Object.assign(new Error("x"), { code: "ENOENT" })), false);
    assert.equal(isClientDisconnect(null), false);
    assert.equal(isClientDisconnect(undefined), false);
  });
});

/**
 * The regression these guard: a client that navigates away while a slow handler
 * (rendering a collection poster, ~700ms) is still working leaves `res`
 * destroyed. Piping the finished response into it threw ERR_STREAM_UNABLE_TO_PIPE
 * out of an async `createServer` callback nobody was catching, which surfaced as
 * a process-level "unhandled promise rejection" in the server log.
 */
describe("guarded", () => {
  let server: Server;
  let base: string;
  const logged: unknown[][] = [];
  const logger = { error: (...args: unknown[]) => void logged.push(args) };

  before(async () => {
    server = createServer(
      guarded(logger, async (req, res) => {
        if (req.url === "/boom") throw new Error("handler blew up");
        // Stands in for a slow query the client may not wait for.
        if (req.url === "/slow") await new Promise((r) => setTimeout(r, 200));
        await sendFetchResponse(
          new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
          res,
        );
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  after(() => {
    server.close();
    server.closeAllConnections();
  });

  test("a client that disconnects mid-request logs nothing and rejects nothing", async () => {
    logged.length = 0;
    let unhandled: unknown = null;
    const onUnhandled = (reason: unknown) => {
      unhandled = reason;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const ac = new AbortController();
      const inflight = fetch(`${base}/slow`, {
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(5000)]),
      }).catch(() => {});
      setTimeout(() => ac.abort(), 20);
      await inflight;
      // Past the handler's 200ms, plus a turn for any rejection to surface.
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(unhandled, null, "a disconnect must not reach process.unhandledRejection");
    assert.deepEqual(logged, [], "a disconnect is routine and must not be logged as an error");
  });

  test("a client that waits still gets its response", async () => {
    logged.length = 0;
    const res = await fetch(`${base}/slow`, { signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(logged, []);
  });

  test("a real handler failure is logged and answered with a 500", async () => {
    logged.length = 0;
    const res = await fetch(`${base}/boom`, { signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Request failed" });
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.[0], "request failed");
    assert.match(JSON.stringify(logged[0]?.[1]), /handler blew up/);
  });
});

describe("sendFetchResponse", () => {
  test("writes nothing to a response the client already abandoned", async () => {
    const writes: string[] = [];
    const res = {
      destroyed: true,
      writableEnded: false,
      headersSent: false,
      writeHead: () => writes.push("head"),
      end: () => writes.push("end"),
    };
    await sendFetchResponse(new Response("hi"), res as never);
    assert.deepEqual(writes, []);
  });
});
