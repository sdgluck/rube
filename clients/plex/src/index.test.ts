import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPlexClient } from "./index.ts";

/**
 * Mock Plex server that records requests and returns canned responses.
 */
function createMockPlex() {
  const requests: { method: string; path: string; params: Record<string, string> }[] = [];

  function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, `http://localhost`);
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) {
      if (k === "X-Plex-Token") continue;
      params[k] = v;
    }

    requests.push({
      method: req.method!,
      path: url.pathname,
      params,
    });

    // PUT /library/metadata/:ratingKey — accept metadata changes
    if (req.method === "PUT" && url.pathname.startsWith("/library/metadata/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }

    res.writeHead(404);
    res.end();
  }

  const server = createServer(handler);

  return {
    requests,
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          resolve(addr.port);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get putRequests() {
      return requests.filter((r) => r.method === "PUT");
    },
  };
}

/**
 * Mock Plex server backed by a mutable set of collections, so a test can make
 * a ratingKey disappear mid-walk the way a concurrently-running rule does.
 *
 * `filterByLabel` mirrors a real server, which narrows a section listing to a
 * `label=` query param. `labelsInListing` is the opposite of what real Plex
 * does — no version tested returns labels with the listing — and exists to
 * pin the shortcut that would apply if one ever did.
 *
 * Both default to off, which is the pessimal server: it ignores the filter and
 * volunteers nothing, so the tests that don't opt in are also the proof that
 * correctness never depended on either.
 */
function createCollectionMockPlex(
  collections: { ratingKey: string; labels: string[] }[],
  { labelsInListing = false, filterByLabel = false }: { labelsInListing?: boolean; filterByLabel?: boolean } = {},
) {
  const live = new Map(collections.map((c) => [c.ratingKey, c.labels]));
  const requests: { method: string; path: string; params: Record<string, string> }[] = [];
  /** ratingKeys to drop from `live` the moment they're fetched (read 404s). */
  const vanishOnRead = new Set<string>();
  /** ratingKeys to drop from `live` just after a successful read (delete 404s). */
  const vanishAfterRead = new Set<string>();

  function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, `http://localhost`);
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) {
      if (k !== "X-Plex-Token") params[k] = v;
    }
    requests.push({ method: req.method!, path: url.pathname, params });

    const json = (body: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.endsWith("/all") && req.method === "GET") {
      // Real Plex matches the tag exactly, case-insensitively.
      const wanted = params.label?.toLowerCase();
      const listed = [...live.entries()].filter(
        ([, labels]) => !filterByLabel || !wanted || labels.some((tag) => tag.toLowerCase() === wanted),
      );
      json({
        MediaContainer: {
          Metadata: listed.map(([ratingKey, labels]) => ({
            ratingKey,
            ...(labelsInListing && labels.length > 0 ? { Label: labels.map((tag) => ({ tag })) } : {}),
          })),
        },
      });
      return;
    }

    const metaMatch = url.pathname.match(/^\/library\/metadata\/([^/]+)$/);
    if (metaMatch) {
      const key = metaMatch[1];
      if (req.method === "DELETE") {
        if (!live.delete(key)) {
          res.writeHead(404);
          res.end();
          return;
        }
        json({});
        return;
      }
      const labels = live.get(key);
      if (!labels) {
        res.writeHead(404);
        res.end();
        return;
      }
      // Simulate the sibling rule's delete landing between our list and our read.
      if (vanishOnRead.delete(key)) {
        live.delete(key);
        res.writeHead(404);
        res.end();
        return;
      }
      if (vanishAfterRead.delete(key)) live.delete(key);
      json({ MediaContainer: { Metadata: [{ ratingKey: key, Label: labels.map((tag) => ({ tag })) }] } });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  const server = createServer(handler);

  return {
    requests,
    live,
    vanishOnRead,
    vanishAfterRead,
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(0, () => resolve((server.address() as { port: number }).port));
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

describe("deleteCollectionsByLabel", () => {
  let mock: ReturnType<typeof createCollectionMockPlex>;
  let client: ReturnType<typeof createPlexClient>;

  const start = async (
    collections: { ratingKey: string; labels: string[] }[],
    opts?: { labelsInListing?: boolean; filterByLabel?: boolean },
  ) => {
    mock = createCollectionMockPlex(collections, opts);
    const port = await mock.start();
    client = createPlexClient({ url: `http://localhost:${port}`, token: "test-token" });
  };

  afterEach(async () => {
    await mock?.stop();
  });

  it("deletes only collections carrying the label", async () => {
    // No `filterByLabel`: a server that ignores the filter must still delete
    // exactly the right collections, just more slowly.
    await start([
      { ratingKey: "1", labels: ["Rule:a"] },
      { ratingKey: "2", labels: ["Rule:b"] },
    ]);

    assert.deepEqual(await client.deleteCollectionsByLabel("1", "Rule:a"), ["1"]);
    assert.deepEqual([...mock.live.keys()], ["2"]);
  });

  it("narrows the listing server-side so only real candidates are inspected", async () => {
    await start(
      [
        { ratingKey: "1", labels: ["Rule:a"] },
        { ratingKey: "2", labels: ["Rule:b"] },
        { ratingKey: "3", labels: ["Rule:b", "Tinkerbell"] },
        { ratingKey: "4", labels: [] },
      ],
      { filterByLabel: true },
    );

    assert.deepEqual(await client.deleteCollectionsByLabel("1", "Rule:a"), ["1"]);
    assert.deepEqual([...mock.live.keys()], ["2", "3", "4"]);

    const listing = mock.requests.find((r) => r.path === "/library/sections/1/all");
    assert.equal(listing?.params.label, "Rule:a");
    // The three collections belonging to nobody we care about are never read.
    assert.deepEqual(
      mock.requests.filter((r) => r.path.startsWith("/library/metadata/")).map((r) => r.path),
      ["/library/metadata/1", "/library/metadata/1"],
      "one label check, one delete — and nothing about 2, 3 or 4",
    );
  });

  it("skips a collection another rule deletes mid-walk instead of failing", async () => {
    await start([
      { ratingKey: "1", labels: ["Rule:b"] },
      { ratingKey: "2", labels: ["Rule:a"] },
    ]);
    mock.vanishOnRead.add("1");

    assert.deepEqual(await client.deleteCollectionsByLabel("1", "Rule:a"), ["2"]);
    assert.deepEqual([...mock.live.keys()], [], "our own collection is still deleted");
  });

  it("uses the labels the listing already carried instead of asking per collection", async () => {
    await start(
      [
        { ratingKey: "1", labels: ["Rule:a"] },
        { ratingKey: "2", labels: ["Rule:b"] },
        { ratingKey: "3", labels: ["Rule:a", "Tinkerbell"] },
      ],
      { labelsInListing: true },
    );

    assert.deepEqual((await client.deleteCollectionsByLabel("1", "Rule:a")).sort(), ["1", "3"]);
    assert.deepEqual([...mock.live.keys()], ["2"]);
    // The whole point: one listing, then only the deletes. On a library with
    // thousands of generated collections this is the difference between two
    // requests and two thousand.
    assert.deepEqual(
      mock.requests.filter((r) => r.method === "GET").map((r) => r.path),
      ["/library/sections/1/all"],
    );
  });

  it("still asks about entries the listing gave no labels for", async () => {
    // Unlabelled collections are indistinguishable from "the listing doesn't
    // carry labels", so they're resolved the slow way rather than assumed.
    await start(
      [
        { ratingKey: "1", labels: ["Rule:a"] },
        { ratingKey: "2", labels: [] },
      ],
      {
        labelsInListing: true,
      },
    );

    assert.deepEqual(await client.deleteCollectionsByLabel("1", "Rule:a"), ["1"]);
    assert.deepEqual(
      mock.requests.filter((r) => r.method === "GET").map((r) => r.path),
      ["/library/sections/1/all", "/library/metadata/2"],
    );
  });

  it("does not count a collection deleted by another rule between read and delete", async () => {
    await start([{ ratingKey: "1", labels: ["Rule:a"] }]);
    // The label read succeeds and matches, then the key is gone before our
    // DELETE lands — nothing was deleted by us, so nothing is counted.
    mock.vanishAfterRead.add("1");

    assert.deepEqual(await client.deleteCollectionsByLabel("1", "Rule:a"), []);
  });
});

describe("setCollectionLabels", () => {
  let mock: ReturnType<typeof createMockPlex>;
  let client: ReturnType<typeof createPlexClient>;

  beforeEach(async () => {
    mock = createMockPlex();
    const port = await mock.start();
    client = createPlexClient({ url: `http://localhost:${port}`, token: "test-token" });
  });

  afterEach(async () => {
    await mock.stop();
  });

  it("sends PUT to /library/metadata/:ratingKey (not /library/sections/)", async () => {
    await client.setCollectionLabels("1", "100", ["Tinkerbell"]);

    assert.equal(mock.putRequests.length, 1);
    assert.equal(mock.putRequests[0].path, "/library/metadata/100");
  });

  it("sends label.locked=1 to replace all labels", async () => {
    await client.setCollectionLabels("1", "100", ["Tinkerbell"]);

    const params = mock.putRequests[0].params;
    assert.equal(params["label.locked"], "1");
  });

  it("sends indexed label params for all desired labels", async () => {
    await client.setCollectionLabels("1", "100", ["Tinkerbell", "User:alice"]);

    assert.equal(mock.putRequests.length, 1);
    const params = mock.putRequests[0].params;

    assert.equal(params["label[0].tag.tag"], "Tinkerbell");
    assert.equal(params["label[1].tag.tag"], "User:alice");
  });

  it("removes a label by omitting it from the desired list", async () => {
    // Desired labels exclude "BecauseYouWatched" — label.locked=1 means Plex
    // replaces the entire label set with what we provide
    await client.setCollectionLabels("1", "100", ["Tinkerbell", "User:alice"]);

    assert.equal(mock.putRequests.length, 1);
    const params = mock.putRequests[0].params;

    assert.equal(params["label[0].tag.tag"], "Tinkerbell");
    assert.equal(params["label[1].tag.tag"], "User:alice");
    assert.equal(params["label.locked"], "1");

    // No tag- removal params — label.locked handles it
    const removeKeys = Object.keys(params).filter((k) => k.endsWith(".tag.tag-"));
    assert.equal(removeKeys.length, 0, "should not use tag- removal params");
  });

  it("sends empty label list with label.locked=1 to remove all labels", async () => {
    await client.setCollectionLabels("1", "100", []);

    assert.equal(mock.putRequests.length, 1);
    const params = mock.putRequests[0].params;

    assert.equal(params["label.locked"], "1");

    const labelKeys = Object.keys(params).filter((k) => k.startsWith("label["));
    assert.equal(labelKeys.length, 0, "should send no label entries");
  });

  it("does not include type or id params (uses URL path instead)", async () => {
    await client.setCollectionLabels("1", "100", ["Tinkerbell"]);

    const params = mock.putRequests[0].params;
    assert.equal(params["type"], undefined);
    assert.equal(params["id"], undefined);
  });
});
