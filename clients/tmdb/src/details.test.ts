/**
 * `fetchItemDetails` for a show, against a real HTTP server standing in for
 * TMDb. `aggregate_credits` files a person's roles under `jobs[]`, not `job`;
 * reading `job` found no director for any show, so a TV Directors rule built
 * nothing and nobody could tell why.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fetchItemDetails } from "./index.ts";

let server: Server;
let cfg: { apiKey: string; baseUrl: string };

const director = (id: number, name: string, episodes: number) => ({
  id,
  name,
  department: "Directing",
  jobs: [{ credit_id: `c${id}`, job: "Director", episode_count: episodes }],
});

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/tv/1396") {
      res.writeHead(404).end(JSON.stringify({ status_code: 34, status_message: "Not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: 1396,
        genres: [],
        production_companies: [],
        networks: [],
        aggregate_credits: {
          cast: [],
          crew: [
            director(1, "Michelle MacLaren", 11),
            director(2, "Adam Bernstein", 6),
            director(3, "Vince Gilligan", 5),
            director(4, "Rian Johnson", 3),
            {
              id: 5,
              name: "Peter Gould",
              department: "Writing",
              jobs: [{ credit_id: "c5", job: "Writer", episode_count: 9 }],
            },
          ],
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  cfg = { apiKey: "key", baseUrl: `http://127.0.0.1:${port}` };
});

after(() => new Promise<void>((done) => server.close(() => done())));

test("a show's directors come from aggregate_credits jobs, most episodes first, capped at three", async () => {
  const details = await fetchItemDetails(cfg, 1396, "tv");
  assert.deepEqual(
    details.directors.map((d) => d.name),
    ["Michelle MacLaren", "Adam Bernstein", "Vince Gilligan"],
  );
});
