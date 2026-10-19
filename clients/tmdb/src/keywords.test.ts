/**
 * Against a real HTTP server standing in for TMDb, like `search.test.ts`: the
 * query encoding and the path a keyword id lands in are the parts worth
 * checking, and a `fetch` stub would agree with whatever this file assumed.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fetchKeyword, searchKeywords } from "./keywords.ts";

let server: Server;
let cfg: { apiKey: string; baseUrl: string };
const requests: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/search/keyword") {
      send({
        page: 1,
        total_pages: 1,
        results: [
          { id: 207317, name: "christmas" },
          { id: 260365, name: "christmas eve" },
        ],
      });
      return;
    }
    if (url.pathname === "/keyword/3335") {
      send({ id: 3335, name: "halloween" });
      return;
    }
    res.writeHead(404).end(JSON.stringify({ status_code: 34, status_message: "Not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  cfg = { apiKey: "key", baseUrl: `http://127.0.0.1:${port}` };
});

after(() => new Promise<void>((done) => server.close(() => done())));

test("searchKeywords returns ids with their names, and encodes the query", async () => {
  requests.length = 0;
  const found = await searchKeywords(cfg, "christmas eve & co");
  assert.deepEqual(found, [
    { id: 207317, name: "christmas" },
    { id: 260365, name: "christmas eve" },
  ]);
  assert.ok(
    requests.some((r) => r.startsWith("/search/keyword?") && r.includes("query=christmas+eve+%26+co")),
    `saw ${requests.join(", ")}`,
  );
});

test("searchKeywords spends no request on an empty query", async () => {
  requests.length = 0;
  assert.deepEqual(await searchKeywords(cfg, "   "), []);
  assert.equal(requests.length, 0);
});

test("fetchKeyword reads one keyword by id", async () => {
  assert.deepEqual(await fetchKeyword(cfg, 3335), { id: 3335, name: "halloween" });
});

test("fetchKeyword surfaces an unknown id as TMDb's own error", async () => {
  await assert.rejects(fetchKeyword(cfg, 1), /does not exist/);
});
