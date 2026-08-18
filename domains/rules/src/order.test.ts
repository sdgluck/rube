/**
 * `position` is one sequence across every rule in the install, but the UI shows
 * it three pages at a time — collection rules on /rules, cleanup rules on
 * /cleanup/rules, metadata rules on /metadata. So a drop almost never names
 * every rule, and the interesting cases are all about what happens to the ones
 * it *didn't* name.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { rules } from "@tinkerbell/db";
import { RulesToken } from "@tinkerbell/domain.rules";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { reorderRules, getRules } = c.resolve(RulesToken);

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

describe("a malformed payload", () => {
  test("an id named twice moves it once, and drops nobody", () => {
    // The input schema doesn't enforce uniqueness. A duplicate used to be dealt
    // into two slots and push the last entry off the end, so one rule was never
    // updated and two held positions that didn't match the drop.
    seed("a", 0);
    seed("b", 1);
    seed("c", 2);

    reorderRules(["c", "c", "a"]);

    assert.deepEqual(order(), ["c", "b", "a"]);
  });

  test("an id for a rule that no longer exists is ignored", () => {
    seed("a", 0);
    seed("b", 1);
    reorderRules(["b", "ghost", "a"]);
    assert.deepEqual(order(), ["b", "a"]);
  });
});
