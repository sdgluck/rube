/**
 * A conflict detector earns its place only if it is quiet. Two rules sharing
 * a library and never touching the same item is the normal case, and a banner
 * that fired on it would be dismissed once and ignored for ever — so most of
 * these tests are about what is *not* reported.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { cleanupCandidates, ruleCollectionMembers, rules } from "@tinkerbell/db";
import { RulesToken } from "@tinkerbell/domain.rules";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { findRuleConflicts, rulesProducingCollectionNamed, rulesRequiringOrder } = c.resolve(RulesToken);
const { reorderRules } = c.resolve(RulesToken);

const T0 = 1_700_000_000_000;

function seedRule(id: string, name: string, config: Record<string, unknown> = {}, enabled = 1, position = 0): void {
  db.insert(rules)
    .values({ id, name, type: "smart_filter", config, enabled, position, createdAt: T0 })
    .onConflictDoNothing()
    .run();
}

function seedBuilt(ruleId: string, sectionKey: string, collectionName: string, members: string[] = []): void {
  db.insert(ruleCollectionMembers)
    .values({
      ruleId,
      sectionKey,
      collectionName,
      members: members.map((ratingKey) => ({ ratingKey, title: `Film ${ratingKey}` })),
      updatedAt: T0,
    })
    .onConflictDoNothing()
    .run();
}

function seedQueued(ruleId: string, ratingKey: string, title = `Film ${ratingKey}`): void {
  db.insert(cleanupCandidates)
    .values({ ruleId, ratingKey, sectionId: "1", title, streak: 3, firstMatchedAt: T0, lastMatchedAt: T0 })
    .onConflictDoNothing()
    .run();
}

beforeEach(() => {
  db.delete(cleanupCandidates).run();
  db.delete(ruleCollectionMembers).run();
  db.delete(rules).run();
});

describe("collection name conflicts", () => {
  test("two rules building the same name in one library collide", () => {
    seedRule("a", "Top Rated Films");
    seedRule("b", "Best Of");
    seedBuilt("a", "1", "Top Rated");
    seedBuilt("b", "1", "Top Rated");

    const conflicts = findRuleConflicts().filter((c) => c.kind === "collection-name");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].subject, "Top Rated");
    assert.deepEqual(conflicts[0].rules.map((r) => r.id).sort(), ["a", "b"]);
    // Says where, so the page can link to the two copies.
    assert.equal(conflicts[0].library?.key, "1");
  });

  test("the same name in two libraries is two collections, not a conflict", () => {
    seedRule("a", "Movies rule");
    seedRule("b", "Shows rule");
    seedBuilt("a", "1", "Top Rated");
    seedBuilt("b", "2", "Top Rated");
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("names are compared case-insensitively", () => {
    seedRule("a", "A");
    seedRule("b", "B");
    seedBuilt("a", "1", "Top Rated");
    seedBuilt("b", "1", "TOP RATED");
    assert.equal(findRuleConflicts().filter((c) => c.kind === "collection-name").length, 1);
  });

  test("a multi-word name survives the report intact", () => {
    // The subject used to be parsed back out of a space-joined composite key,
    // which truncated every collection anyone actually names.
    seedRule("a", "A");
    seedRule("b", "B");
    seedBuilt("a", "1", "Best of the Decade");
    seedBuilt("b", "1", "Best of the Decade");
    assert.equal(findRuleConflicts()[0].subject, "Best of the Decade");
  });

  test("one rule building one collection is not a conflict with itself", () => {
    seedRule("a", "A");
    seedBuilt("a", "1", "Top Rated");
    assert.deepEqual(findRuleConflicts(), []);
  });
});

describe("metadata field conflicts", () => {
  const metadataRule = (fields: Record<string, string>, sections?: string[]) => ({
    action: { kind: "metadata", set: fields },
    ...(sections ? { sections } : {}),
  });

  test("two rules writing the same field in the same library collide", () => {
    seedRule("a", "Sort titles", metadataRule({ titleSort: "{sortableTitle}" }, ["Movies"]));
    seedRule("b", "Also sort titles", metadataRule({ titleSort: "{title}" }, ["Movies"]));

    const conflicts = findRuleConflicts().filter((c) => c.kind === "metadata-field");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].subject, "titleSort");
  });

  test("different fields are not a conflict", () => {
    seedRule("a", "A", metadataRule({ titleSort: "x" }, ["Movies"]));
    seedRule("b", "B", metadataRule({ studio: "y" }, ["Movies"]));
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("different libraries are not a conflict", () => {
    seedRule("a", "A", metadataRule({ titleSort: "x" }, ["Movies"]));
    seedRule("b", "B", metadataRule({ titleSort: "y" }, ["TV Shows"]));
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("a rule with no sections covers every library, so it overlaps", () => {
    seedRule("a", "A", metadataRule({ titleSort: "x" }));
    seedRule("b", "B", metadataRule({ titleSort: "y" }, ["Movies"]));
    assert.equal(findRuleConflicts().filter((c) => c.kind === "metadata-field").length, 1);
  });

  test("a disabled rule cannot be in conflict with anything", () => {
    seedRule("a", "A", metadataRule({ titleSort: "x" }, ["Movies"]));
    seedRule("b", "B", metadataRule({ titleSort: "y" }, ["Movies"]), 0);
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("the later rule is named as the winner", () => {
    seedRule("a", "First", metadataRule({ titleSort: "x" }, ["Movies"]), 1, 0);
    seedRule("b", "Second", metadataRule({ titleSort: "y" }, ["Movies"]), 1, 1);
    assert.match(findRuleConflicts()[0].detail, /"Second" runs second/);
  });

  test("reordering changes which rule is named as the winner", () => {
    seedRule("a", "First", metadataRule({ titleSort: "x" }, ["Movies"]), 1, 0);
    seedRule("b", "Second", metadataRule({ titleSort: "y" }, ["Movies"]), 1, 1);
    reorderRules(["b", "a"]);
    assert.match(findRuleConflicts()[0].detail, /"First" runs second/);
  });
});

describe("cleanup versus collection conflicts", () => {
  const cleanupRule = (mode: string) => ({ action: { kind: "cleanup", mode } });

  test("an item queued for deletion that another rule features is reported", () => {
    seedRule("cleaner", "Old and unwatched", cleanupRule("delete"));
    seedRule("builder", "Hidden gems");
    seedQueued("cleaner", "100", "The Quiet Antenna");
    seedBuilt("builder", "1", "Hidden Gems", ["100"]);

    const conflicts = findRuleConflicts().filter((c) => c.kind === "cleanup-vs-collection");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].subject, "The Quiet Antenna");
  });

  test("a non-destructive cleanup mode is not in conflict with featuring it", () => {
    // Labelling an item and putting it in a collection are compatible acts.
    seedRule("cleaner", "Tag the old ones", cleanupRule("label"));
    seedRule("builder", "Hidden gems");
    seedQueued("cleaner", "100");
    seedBuilt("builder", "1", "Hidden Gems", ["100"]);
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("a queued item nothing features is not a conflict", () => {
    seedRule("cleaner", "Old and unwatched", cleanupRule("delete"));
    seedRule("builder", "Hidden gems");
    seedQueued("cleaner", "100");
    seedBuilt("builder", "1", "Hidden Gems", ["999"]);
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("an already-actioned row is history, not a pending conflict", () => {
    seedRule("cleaner", "Old and unwatched", cleanupRule("delete"));
    seedRule("builder", "Hidden gems");
    seedQueued("cleaner", "100");
    db.update(cleanupCandidates).set({ actionedAt: T0 }).run();
    seedBuilt("builder", "1", "Hidden Gems", ["100"]);
    assert.deepEqual(findRuleConflicts(), []);
  });

  test("deletion is reported ahead of a mere naming clash", () => {
    seedRule("cleaner", "Old and unwatched", cleanupRule("delete"));
    seedRule("builder", "Hidden gems");
    seedRule("other", "Also hidden gems");
    seedQueued("cleaner", "100");
    seedBuilt("builder", "1", "Hidden Gems", ["100"]);
    seedBuilt("other", "1", "Hidden Gems", ["200"]);

    assert.equal(findRuleConflicts()[0].kind, "cleanup-vs-collection");
  });
});

describe("rulesProducingCollectionNamed", () => {
  test("names the rules already building it, ignoring the one being edited", () => {
    seedRule("a", "A");
    seedRule("b", "B");
    seedBuilt("a", "1", "Top Rated");
    seedBuilt("b", "1", "Top Rated");

    assert.deepEqual(
      rulesProducingCollectionNamed("top rated")
        .map((r) => r.id)
        .sort(),
      ["a", "b"],
    );
    assert.deepEqual(
      rulesProducingCollectionNamed("Top Rated", "a").map((r) => r.id),
      ["b"],
    );
  });

  test("an empty name matches nothing", () => {
    seedRule("a", "A");
    seedBuilt("a", "1", "Top Rated");
    assert.deepEqual(rulesProducingCollectionNamed("   "), []);
  });
});

describe("rulesRequiringOrder", () => {
  const writes = (field: string, sections?: string[]) => ({
    action: { kind: "metadata", set: { [field]: "x" } },
    ...(sections ? { sections } : {}),
  });
  const after = (...ids: string[]) => ({ schedule: { afterRules: ids } });
  /** The constrained rules in the order the batch will run them. */
  const order = () => {
    const { ids, rank } = rulesRequiringOrder();
    return [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  };

  test("names both rules that write the same field in the same library", () => {
    // The nightly batch runs these one at a time, in position order, because
    // the Rules page tells the user the later one's value is the one that
    // survives — and a pool of three workers made that whichever finished last.
    seedRule("a", "Sort titles", writes("titleSort"), 1, 0);
    seedRule("b", "Also sort titles", writes("titleSort"), 1, 1);
    assert.deepEqual(order(), ["a", "b"]);
  });

  test("says nothing about rules that cannot collide", () => {
    // Different fields, and different libraries: both are the normal case, and
    // serialising them would cost the batch its concurrency for nothing.
    seedRule("a", "Sort titles", writes("titleSort", ["Films"]), 1, 0);
    seedRule("b", "Content ratings", writes("contentRating", ["Films"]), 1, 1);
    seedRule("c", "Sort titles on TV", writes("titleSort", ["TV"]), 1, 2);
    assert.deepEqual(order(), []);
  });

  test("ignores a disabled rule", () => {
    seedRule("a", "Sort titles", writes("titleSort"), 1, 0);
    seedRule("b", "Also sort titles", writes("titleSort"), 0, 1);
    assert.deepEqual(order(), []);
  });

  test("puts a rule after the one it declares itself to run after", () => {
    // The two-stage curation pair: "a" builds the pool, "b" picks from it. The
    // batch used to run both concurrently, so "b" read a pool mid-rebuild.
    seedRule("a", "Every Nolan film", {}, 1, 0);
    seedRule("b", "Best three Nolan films", after("a"), 1, 1);
    assert.deepEqual(order(), ["a", "b"]);
  });

  test("respects the dependency even when position disagrees", () => {
    // Position says "b" first; `afterRules` says otherwise, and the explicit
    // dependency is the stronger statement of intent.
    seedRule("a", "Pool", {}, 1, 5);
    seedRule("b", "Curated", after("a"), 1, 0);
    assert.deepEqual(order(), ["a", "b"]);
  });

  test("orders a chain three deep", () => {
    seedRule("c", "Third", after("b"), 1, 0);
    seedRule("b", "Second", after("a"), 1, 1);
    seedRule("a", "First", {}, 1, 2);
    assert.deepEqual(order(), ["a", "b", "c"]);
  });

  test("ignores an edge to a rule that is disabled or gone", () => {
    // Nothing is going to run and satisfy it, so treating it as a constraint
    // would strand the dependent rule in the sequential lane forever.
    seedRule("a", "Pool", {}, 0, 0);
    seedRule("b", "Curated", after("a"), 1, 1);
    seedRule("c", "Orphaned", after("nonexistent"), 1, 2);
    assert.deepEqual(order(), []);
  });

  test("falls back to running order for a cycle rather than dropping the rules", () => {
    // `afterRules` can be edited into a cycle from either end, so this is a real
    // state. Deterministic beats correct-or-nothing here.
    seedRule("a", "One", after("b"), 1, 0);
    seedRule("b", "Two", after("a"), 1, 1);
    assert.deepEqual(order(), ["a", "b"]);
  });
});
