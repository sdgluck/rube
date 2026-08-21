import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { startMockMdblist, type MockListServer } from "@tinkerbell/test-support/lists";
import { createMdblistClient, mdblistListPath } from "./index.ts";

/**
 * Against a server rather than a `fetch` stub, because everything worth
 * getting wrong here is on the wire: which path a pasted URL resolves to,
 * whether the offset advances, and whether a 200-with-`error` is noticed.
 */

const LIST = {
  summary: { id: 2410, name: "Horror Movies", slug: "horror", owner: "hdlists", itemCount: 3, likes: 139 },
  items: [
    { title: "Alien", year: 1979, mediaType: "movie" as const, imdbId: "tt0078748", tmdbId: 348 },
    { title: "The Thing", year: 1982, mediaType: "movie" as const, imdbId: "tt0084787", tmdbId: 1091 },
    { title: "Hannibal", year: 2013, mediaType: "show" as const, imdbId: "tt2243973", tmdbId: 40008 },
  ],
};

async function withServer(): Promise<{ server: MockListServer; client: ReturnType<typeof createMdblistClient> }> {
  const server = await startMockMdblist([LIST]);
  return { server, client: createMdblistClient({ apiKey: "k", baseUrl: server.origin }) };
}

describe("reading an MDBList list reference", () => {
  test("accepts a bare numeric id", () => {
    assert.equal(mdblistListPath("12345"), "/lists/12345");
  });

  test("accepts the user/listname slug form", () => {
    assert.equal(mdblistListPath("hdlists/horror"), "/lists/hdlists/horror");
  });

  test("strips a pasted share URL down to the slug", () => {
    assert.equal(mdblistListPath("https://mdblist.com/lists/hdlists/horror/"), "/lists/hdlists/horror");
  });

  test("encodes each segment so a name can't escape into the query string", () => {
    const path = mdblistListPath("hdlists/horror?limit=1");
    assert.equal(path, "/lists/hdlists/horror%3Flimit%3D1");
    // The separators must survive the encoding, or the path addresses nothing.
    assert.equal(path.split("/").length, 4);
  });
});

describe("the MDBList client", () => {
  test("searches lists and flattens the response", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const hits = await client.searchLists("horror");
    assert.equal(hits.length, 1);
    assert.deepEqual(
      { name: hits[0]!.name, owner: hits[0]!.owner, itemCount: hits[0]!.itemCount, likes: hits[0]!.likes },
      { name: "Horror Movies", owner: "hdlists", itemCount: 3, likes: 139 },
    );
    // The term reaches the server intact rather than as part of the path.
    assert.deepEqual(server.journal.searches, ["horror"]);
  });

  test("reads a list's name from the one-element array MDBList actually sends", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const list = await client.getList("2410");
    assert.equal(list?.name, "Horror Movies");
  });

  test("merges the movies and shows arrays, keeping both id kinds", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const items = await client.getListItems("hdlists/horror");
    assert.deepEqual(
      items.map((i) => [i.title, i.mediaType, i.imdbId, i.tmdbId]),
      [
        ["Alien", "movie", "tt0078748", 348],
        ["The Thing", "movie", "tt0084787", 1091],
        ["Hannibal", "show", "tt2243973", 40008],
      ],
    );
  });

  test("a slug reference is addressed as a slug, not as an id", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    await client.getList("https://mdblist.com/lists/hdlists/horror");
    assert.ok(
      server.journal.requests.some((r) => r.startsWith("GET /lists/hdlists/horror?")),
      `expected a slug path, got ${server.journal.requests.join(", ")}`,
    );
  });

  test("stops at the requested limit rather than walking the whole list", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const items = await client.getListItems("2410", { limit: 2 });
    assert.equal(items.length, 2);
  });

  test("a 200 carrying an `error` field is a failure, not an empty list", async () => {
    const server = await startMockMdblist([LIST]);
    after(() => server.close());
    const client = createMdblistClient({ apiKey: "k", baseUrl: server.origin });

    // An unknown list is exactly how MDBList reports this: 200, with prose.
    await assert.rejects(() => client.getListItems("9999"), /MDBList: list not found/);
  });

  test("refuses to call out at all without a key, naming the setting", async () => {
    const client = createMdblistClient({ apiKey: null });
    await assert.rejects(() => client.searchLists("horror"), /API key is not configured/);
  });
});
