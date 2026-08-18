/**
 * The collections mirror is not only a cache.
 *
 * Cleanup's "never delete anything in this collection" protections resolve
 * through `collections` and `collection_items`, so a sweep that deletes rows
 * this run merely didn't look at doesn't just cost a page its data — it
 * silently resolves those protections to nothing, and the next cleanup run
 * deletes items somebody explicitly protected. Hence the section scoping.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { collectionItems, collections } from "@tinkerbell/db";
import { CollectionsToken } from "@tinkerbell/domain.collections";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { syncCollections } = c.resolve(CollectionsToken);

const { createPlexClient } = await import("@tinkerbell/plex");

type PlexClient = ReturnType<typeof createPlexClient>;

const MOVIES = { key: "1", title: "Movies", type: "movie" };
const TV = { key: "2", title: "TV", type: "show" };

/** Collections per section key, and members per collection. */
function fakeClient(bySection: Record<string, string[]>, members: Record<string, string[]> = {}): PlexClient {
  return {
    async getCollections(sectionKey: string) {
      return (bySection[sectionKey] ?? []).map((ratingKey) => ({ ratingKey }));
    },
    async getCollectionDetail(ratingKey: string) {
      return {
        title: `Collection ${ratingKey}`,
        summary: "",
        childCount: 0,
        labels: [],
        thumb: "",
        smart: false,
        content: "",
        addedAt: null,
      };
    },
    async getCollectionChildren(ratingKey: string) {
      return (members[ratingKey] ?? []).map((itemRatingKey) => ({ ratingKey: itemRatingKey }));
    },
  } as unknown as PlexClient;
}

const BOTH = { "1": ["c-movies"], "2": ["c-tv"] };
const MEMBERS = { "c-movies": ["m1"], "c-tv": ["t1", "t2"] };

function storedKeys(): string[] {
  return db
    .select()
    .from(collections)
    .all()
    .map((r) => r.plexRatingKey)
    .sort();
}

beforeEach(() => {
  db.delete(collectionItems).run();
  db.delete(collections).run();
});

describe("the stale sweep", () => {
  test("a sync scoped to one section keeps the other section's collections and their members", async () => {
    await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES, TV]);

    const stats = await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES], undefined, {
      knownSectionKeys: ["1", "2"],
    });

    assert.equal(stats.removed, 0);
    assert.deepEqual(storedKeys(), ["c-movies", "c-tv"]);
    // The membership rows are what a collection-based protection actually
    // resolves through, so losing them is the same bug one table along.
    assert.equal(
      db
        .select()
        .from(collectionItems)
        .all()
        .filter((r) => r.collectionRatingKey === "c-tv").length,
      2,
    );
  });

  test("it still removes a collection deleted from a section it did walk", async () => {
    await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES, TV]);

    const stats = await syncCollections(fakeClient({ ...BOTH, "1": [] }, MEMBERS), [MOVIES], undefined, {
      knownSectionKeys: ["1", "2"],
    });

    assert.equal(stats.removed, 1);
    assert.deepEqual(storedKeys(), ["c-tv"]);
    assert.equal(
      db
        .select()
        .from(collectionItems)
        .all()
        .filter((r) => r.collectionRatingKey === "c-movies").length,
      0,
    );
  });

  test("it removes the collections of a library that is no longer managed", async () => {
    await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES, TV]);

    const stats = await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES], undefined, { knownSectionKeys: ["1"] });

    assert.equal(stats.removed, 1);
    assert.deepEqual(storedKeys(), ["c-movies"]);
  });

  test("with no managed set given, the sections walked are all there are", async () => {
    await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES, TV]);
    const stats = await syncCollections(fakeClient(BOTH, MEMBERS), [MOVIES]);
    assert.equal(stats.removed, 1);
  });
});
