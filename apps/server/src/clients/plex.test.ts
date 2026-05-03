import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPlexClient } from "./plex/index.ts";

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
