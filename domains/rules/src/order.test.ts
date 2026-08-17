/**
 * `position` is one sequence across every rule in the install, but the UI shows
 * it three pages at a time — collection rules on /rules, cleanup rules on
 * /cleanup/rules, metadata rules on /metadata. So a drop almost never names
 * every rule, and the interesting cases are all about what happens to the ones
 * it *didn't* name.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-rules-order-test-");

const { db, rules } = await import("@tinkerbell/db");
const { reorderRules, getRules } = await import("./index.ts");

const T0 = 1_700_000_000_000;

function seed(id: string, position: number): void {
  db.insert(rules)
    .values({ id, name: id, type: "smart_filter", config: {}, enabled: 1, position, createdAt: T0 + position })
    .run();
}

const order = () => getRules().map((r) => r.id);

beforeEach(() => {
  db.delete(rules).run();
});

describe("reorderRules", () => {
  test("applies a full reorder", () => {
    seed("a", 0);
    seed("b", 1);
    seed("c", 2);

    reorderRules(["c", "a", "b"]);

    assert.deepEqual(order(), ["c", "a", "b"]);
  });

  test("renumbers from zero so ties can't survive a reorder", () => {
    // Every rule on an install that has never reordered anything sits at 0.
    seed("a", 0);
    seed("b", 0);
    seed("c", 0);

    reorderRules(["c", "b", "a"]);

    assert.deepEqual(
      getRules().map((r) => r.position),
      [0, 1, 2],
    );
  });

  test("a subset reorder leaves the rules it didn't name where they were", () => {
    // The shape of a drag on /cleanup/rules: only the cleanup rules are sent,
    // and the collection rules interleaved with them must not be renumbered on
    // top of. Numbering the subset 0..n-1 would put "cleanup2" at 0 — ahead of
    // "collection1", which the user never touched and cannot even see.
    seed("collection1", 0);
    seed("cleanup1", 1);
    seed("collection2", 2);
    seed("cleanup2", 3);

    reorderRules(["cleanup2", "cleanup1"]);

    // The two cleanup rules swap, each landing in a slot cleanup already held.
    assert.deepEqual(order(), ["collection1", "cleanup2", "collection2", "cleanup1"]);
  });

  test("ignores an id for a rule that no longer exists", () => {
    // Deleted in another tab between the page load and the drop. Passing it
    // through would consume a slot and shift everything after it by one.
    seed("a", 0);
    seed("b", 1);

    reorderRules(["b", "gone", "a"]);

    assert.deepEqual(order(), ["b", "a"]);
  });
});
