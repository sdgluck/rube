import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { startMockTrakt, type MockListServer } from "@tinkerbell/test-support/lists";
import { createTraktClient } from "./index.ts";

/**
 * Against a server rather than a `fetch` stub: the client id travels as a
 * header rather than a query parameter, the list envelope differs between
 * search and metadata, and paging ends on a short page. A stub agrees with
 * whatever the caller believes about all three.
 */

const LIST = {
  summary: { id: 8842, name: "Best of 2024", slug: "best-of-2024", owner: "someone", itemCount: 3, likes: 51 },
  items: [
    { title: "Dune: Part Two", year: 2024, mediaType: "movie" as const, imdbId: "tt15239678", tmdbId: 693134 },
    { title: "Shogun", year: 2024, mediaType: "show" as const, imdbId: "tt2788316", tmdbId: 86831 },
    { title: "Anora", year: 2024, mediaType: "movie" as const, imdbId: "tt28607951", tmdbId: 1064213 },
  ],
};

async function withServer(): Promise<{ server: MockListServer; client: ReturnType<typeof createTraktClient> }> {
  const server = await startMockTrakt([LIST]);
  return { server, client: createTraktClient({ clientId: "cid", baseUrl: server.origin }) };
}

describe("the Trakt client", () => {
  test("unwraps the search envelope into a flat summary", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const hits = await client.searchLists("best of");
    assert.equal(hits.length, 1);
    assert.deepEqual(
      { id: hits[0]!.id, name: hits[0]!.name, owner: hits[0]!.owner, likes: hits[0]!.likes },
      { id: 8842, name: "Best of 2024", owner: "someone", likes: 51 },
    );
    assert.deepEqual(server.journal.searches, ["best of"]);
  });

  test("trending lists come back in the same shape as a search", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const hits = await client.trendingLists();
    assert.equal(hits[0]!.name, "Best of 2024");
  });

  test("reads a numeric id, which is what a rule stores", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    assert.equal((await client.getList("8842")).name, "Best of 2024");
  });

  test("a share URL is addressed as /users/<user>/lists/<slug>", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    await client.getList("https://trakt.tv/users/someone/lists/best-of-2024");
    assert.ok(
      server.journal.requests.includes("GET /users/someone/lists/best-of-2024"),
      `expected a user/slug path, got ${server.journal.requests.join(", ")}`,
    );
  });

  test("items carry both id kinds and the media type", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    const items = await client.getListItems("8842");
    assert.deepEqual(
      items.map((i) => [i.title, i.mediaType, i.imdbId, i.tmdbId]),
      [
        ["Dune: Part Two", "movie", "tt15239678", 693134],
        ["Shogun", "show", "tt2788316", 86831],
        ["Anora", "movie", "tt28607951", 1064213],
      ],
    );
  });

  test("stops at the requested limit rather than walking the whole list", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    assert.equal((await client.getListItems("8842", { limit: 2 })).length, 2);
  });

  test("a 403 is reported as a privacy problem, which is what it usually is", async () => {
    const server = await startMockTrakt([LIST]);
    after(() => server.close());
    const client = createTraktClient({ clientId: "cid", baseUrl: server.origin });
    // A 403 is not on the retryable list, so it surfaces on the first attempt.
    server.failNext(1, 403);

    await assert.rejects(() => client.getList("8842"), /check the list is public/);
  });

  test("a missing list says so rather than surfacing a bare 404", async () => {
    const { server, client } = await withServer();
    after(() => server.close());

    await assert.rejects(() => client.getList("1"), /doesn't exist/);
  });

  test("refuses to call out at all without a key, naming the setting", async () => {
    const client = createTraktClient({ clientId: null });
    await assert.rejects(() => client.searchLists("x"), /API key is not configured/);
  });
});
