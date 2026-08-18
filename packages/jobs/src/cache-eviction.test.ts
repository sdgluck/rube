/**
 * Jobs delete collections through the Plex client, which knows nothing about
 * the local cache. `forgetCollections` is what keeps the two in step: without
 * it, a rule run's freshly deleted collections sit in the cache next to the
 * ones it created to replace them, and the Collections page shows what looks
 * like a duplicate for every collection the rule makes — until the nightly
 * sync happens to notice they're gone from Plex.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { collectionItems, collections } from "@tinkerbell/db";
import { CollectionsToken } from "@tinkerbell/domain.collections";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { forgetCollections } = c.resolve(CollectionsToken);

function seed(ratingKey: string, title: string): void {
  db.insert(collections)
    .values({
      plexRatingKey: ratingKey,
      sectionId: "1",
      sectionTitle: "Films",
      title,
      childCount: 2,
      labels: ["Tinkerbell", "Rule:rule-a"],
      addedAt: 1_700_000_000,
      syncedAt: Date.now(),
    })
    .run();
  db.insert(collectionItems)
    .values([
      { collectionRatingKey: ratingKey, itemRatingKey: `${ratingKey}-item-1` },
      { collectionRatingKey: ratingKey, itemRatingKey: `${ratingKey}-item-2` },
    ])
    .run();
}

function keys(): string[] {
  return db
    .select({ key: collections.plexRatingKey })
    .from(collections)
    .all()
    .map((r) => r.key)
    .sort();
}

describe("forgetCollections", () => {
  beforeEach(() => {
    db.delete(collections).run();
    db.delete(collectionItems).run();
  });

  it("removes the rows for the given keys and leaves the rest alone", () => {
    seed("1", "Top Picks");
    seed("2", "Top Picks");
    seed("3", "Something Else");

    const removed = forgetCollections(["1", "2"]);

    assert.equal(removed, 2);
    assert.deepEqual(keys(), ["3"]);
  });

  it("drops membership rows alongside the collection", () => {
    seed("1", "Top Picks");
    seed("2", "Other");

    forgetCollections(["1"]);

    const remaining = db.select({ key: collectionItems.collectionRatingKey }).from(collectionItems).all();
    assert.deepEqual(new Set(remaining.map((r) => r.key)), new Set(["2"]));
  });

  it("is a no-op on an empty list rather than deleting everything", () => {
    seed("1", "Top Picks");

    assert.equal(forgetCollections([]), 0);
    assert.deepEqual(keys(), ["1"]);
  });

  it("tolerates keys that are not in the cache", () => {
    seed("1", "Top Picks");

    assert.equal(forgetCollections(["1", "never-synced"]), 1);
    assert.deepEqual(keys(), []);
  });
});
