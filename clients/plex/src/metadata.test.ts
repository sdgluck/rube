import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPlexClient, type PlexClient } from "./index.ts";

/**
 * A Plex that answers one item's metadata and records every PUT.
 *
 * The item is mutable so a test can set up "this field is already what we'd
 * write" and "this field is locked to something else" — the two cases the
 * write path is supposed to treat differently from a plain change.
 */
function createMetadataMock(meta: Record<string, unknown>) {
  const requests: { method: string; path: string; params: Record<string, string> }[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, "http://localhost");
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) {
      if (k === "X-Plex-Token") continue;
      params[k] = v;
    }
    requests.push({ method: req.method!, path: url.pathname, params });

    if (req.method === "GET" && url.pathname.startsWith("/library/metadata/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ MediaContainer: { Metadata: [meta] } }));
      return;
    }
    if (req.method === "PUT") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return {
    requests,
    setMeta(next: Record<string, unknown>) {
      meta = next;
    },
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(0, () => resolve((server.address() as { port: number }).port));
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get puts() {
      return requests.filter((r) => r.method === "PUT");
    },
  };
}

const ITEM = {
  ratingKey: "42",
  title: "The Matrix",
  type: "movie",
  titleSort: "Matrix, The",
  contentRating: "US:R",
  studio: "Warner Bros.",
  year: 1999,
  Genre: [{ tag: "Action" }, { tag: "Sci-Fi" }],
  Label: [{ tag: "Rube" }],
  Field: [{ name: "titleSort", locked: true }],
};

describe("item metadata", () => {
  let mock: ReturnType<typeof createMetadataMock>;
  let client: PlexClient;

  async function start(meta: Record<string, unknown> = ITEM) {
    mock = createMetadataMock(meta);
    const port = await mock.start();
    client = createPlexClient({ url: `http://localhost:${port}`, token: "t" });
  }

  beforeEach(() => start());
  afterEach(() => mock.stop());

  describe("getItemFields", () => {
    it("reads scalar fields, tag sets, and lock state", async () => {
      const fields = await client.getItemFields("42");

      assert.equal(fields.title, "The Matrix");
      assert.equal(fields.fields.titleSort, "Matrix, The");
      assert.equal(fields.fields.contentRating, "US:R");
      // Numbers come back as strings — every write is a query parameter, and
      // callers comparing "1999" against 1999 would rewrite the field forever.
      assert.equal(fields.fields.year, "1999");
      assert.deepEqual(fields.tags.genre, ["Action", "Sci-Fi"]);
      assert.deepEqual(fields.tags.label, ["Rube"]);
      assert.deepEqual(fields.locked, ["titleSort"]);
    });

    it("treats a server that reports no Field array as nothing locked", async () => {
      await mock.stop();
      await start({ ratingKey: "42", title: "The Matrix", type: "movie" });

      assert.deepEqual((await client.getItemFields("42")).locked, []);
    });
  });

  describe("updateItemFields", () => {
    it("writes to the section endpoint with the section type and item id", async () => {
      await client.updateItemFields("1", "movie", "42", { summary: "Neo takes a pill." }, { lock: true });

      assert.equal(mock.puts.length, 1);
      assert.equal(mock.puts[0].path, "/library/sections/1/all");
      assert.equal(mock.puts[0].params.type, "1");
      assert.equal(mock.puts[0].params.id, "42");
      assert.equal(mock.puts[0].params["summary.value"], "Neo takes a pill.");
      assert.equal(mock.puts[0].params["summary.locked"], "1");
    });

    it("sends locked=0 when the caller hands the field to Plex's agents", async () => {
      await client.updateItemFields("1", "movie", "42", { summary: "Neo takes a pill." }, { lock: false });

      assert.equal(mock.puts[0].params["summary.locked"], "0");
    });

    it("makes no HTTP call at all when every value is already what we'd write", async () => {
      const written = await client.updateItemFields("1", "movie", "42", { titleSort: "Matrix, The" }, { lock: true });

      assert.deepEqual(written, []);
      assert.equal(mock.puts.length, 0, "a nightly job over 5,000 unchanged items must be free");
    });

    it("still writes an unchanged value when only the lock state differs", async () => {
      // `contentRating` holds the right text but is unlocked, so the next
      // agent refresh can revert it. "Make this stick" is a real change.
      const written = await client.updateItemFields("1", "movie", "42", { contentRating: "US:R" }, { lock: true });

      assert.deepEqual(written, ["contentRating"]);
      assert.equal(mock.puts[0].params["contentRating.locked"], "1");
    });

    it("sends only the fields that changed", async () => {
      await client.updateItemFields(
        "1",
        "movie",
        "42",
        { titleSort: "Matrix, The", studio: "Warner Bros. Pictures" },
        { lock: true },
      );

      assert.equal(mock.puts[0].params["studio.value"], "Warner Bros. Pictures");
      assert.ok(!("titleSort.value" in mock.puts[0].params), "titleSort was already correct and locked");
    });

    it("reuses a caller-supplied read instead of fetching again", async () => {
      const current = await client.getItemFields("42");
      const before = mock.requests.filter((r) => r.method === "GET").length;

      await client.updateItemFields("1", "movie", "42", { studio: "A24" }, { lock: true, current });

      assert.equal(mock.requests.filter((r) => r.method === "GET").length, before);
    });

    it("refuses a section type Plex has no number for", async () => {
      await assert.rejects(
        () => client.updateItemFields("1", "nonsense", "42", { studio: "A24" }, { lock: true }),
        /Unknown section type/,
      );
    });
  });

  describe("unlockItemFields", () => {
    it("clears the lock without sending a value", async () => {
      await client.unlockItemFields("1", "movie", "42", ["titleSort", "summary"]);

      const params = mock.puts[0].params;
      assert.equal(params["titleSort.locked"], "0");
      assert.equal(params["summary.locked"], "0");
      assert.ok(!("titleSort.value" in params), "unlocking must not also rewrite the field");
    });

    it("does nothing when given no fields", async () => {
      await client.unlockItemFields("1", "movie", "42", []);
      assert.equal(mock.puts.length, 0);
    });
  });

  describe("setItemTags", () => {
    it("uses the indexed tag form", async () => {
      await client.setItemTags("1", "movie", "42", "genre", ["Action", "Thriller"]);

      const params = mock.puts[0].params;
      assert.equal(params["genre[0].tag.tag"], "Action");
      assert.equal(params["genre[1].tag.tag"], "Thriller");
      assert.equal(params["genre.locked"], "1");
    });

    it("distinguishes clearing a tag set from not setting it", async () => {
      await client.setItemTags("1", "movie", "42", "genre", []);

      const params = mock.puts[0].params;
      // Without the empty marker Plex reads the PUT as "genre wasn't
      // mentioned" and leaves every existing tag in place — a clear that
      // silently does nothing.
      assert.equal(params["genre[].tag.tag"], "");
      assert.equal(params["genre.locked"], "1");
    });
  });

  describe("refreshItem / matchItem", () => {
    it("refreshes via the item endpoint", async () => {
      await client.refreshItem("42");
      assert.equal(mock.puts[0].path, "/library/metadata/42/refresh");
    });

    it("passes the provider id through to match", async () => {
      await client.matchItem("42", "tmdb://603");
      assert.equal(mock.puts[0].path, "/library/metadata/42/match");
      assert.equal(mock.puts[0].params.guid, "tmdb://603");
    });
  });
});
