import { classify } from "./collections-sweep.ts";
/**
 * `classify` decides what gets deleted off a real Plex server, so these tests
 * are as much about what it must NOT touch as what it collects.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";

const c = createTestContainer();
after(() => c.dispose());

// The module reaches @tinkerbell/db transitively (via domain.collections),
// which opens its connection at import time.

type Candidate = Parameters<typeof classify>[0][number];

let nextKey = 100;
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    ratingKey: String(nextKey++),
    title: "Top Picks",
    sectionId: "1",
    sectionTitle: "Films",
    ruleId: "rule-a",
    addedAt: 1_700_000_000,
    itemCount: 20,
    ...overrides,
  };
}

const KNOWN = new Set(["rule-a", "rule-b"]);

describe("classify", () => {
  it("keeps a rule's single collection", () => {
    const { orphans, duplicates } = classify([candidate()], KNOWN);

    assert.deepEqual(orphans, []);
    assert.deepEqual(duplicates, []);
  });

  it("collects collections whose rule no longer exists", () => {
    const orphan = candidate({ ruleId: "deleted-rule" });
    const { orphans } = classify([candidate(), orphan], KNOWN);

    assert.deepEqual(
      orphans.map((c) => c.ratingKey),
      [orphan.ratingKey],
    );
  });

  it("keeps the newest of a duplicate group and deletes the rest", () => {
    const oldest = candidate({ addedAt: 1_700_000_000 });
    const middle = candidate({ addedAt: 1_700_000_100 });
    const newest = candidate({ addedAt: 1_700_000_200 });

    const { duplicates } = classify([oldest, newest, middle], KNOWN);

    assert.deepEqual(duplicates.map((c) => c.ratingKey).sort(), [oldest.ratingKey, middle.ratingKey].sort());
  });

  it("breaks ties on rating key — two racing runs create within the same second", () => {
    const first = candidate({ ratingKey: "500", addedAt: 1_700_000_000 });
    const second = candidate({ ratingKey: "501", addedAt: 1_700_000_000 });

    const { duplicates } = classify([first, second], KNOWN);

    // Plex issues rating keys in ascending order, so 501 is the later one.
    assert.deepEqual(
      duplicates.map((c) => c.ratingKey),
      ["500"],
    );
  });

  it("treats same-title collections from different rules as distinct", () => {
    const a = candidate({ ruleId: "rule-a" });
    const b = candidate({ ruleId: "rule-b" });

    const { duplicates } = classify([a, b], KNOWN);

    assert.deepEqual(duplicates, []);
  });

  it("treats same-title collections in different sections as distinct", () => {
    const films = candidate({ sectionId: "1", sectionTitle: "Films" });
    const tv = candidate({ sectionId: "2", sectionTitle: "TV" });

    const { duplicates } = classify([films, tv], KNOWN);

    assert.deepEqual(duplicates, []);
  });

  it("does not merge distinct titles that share a separator-shaped prefix", () => {
    // The group key joins section, rule and title. A naive separator would let
    // a title containing it collide with a different group and delete a
    // collection nothing is duplicating.
    const a = candidate({ title: "Sci-Fi" });
    const b = candidate({ title: "Sci-Fi: The Sequel" });

    const { duplicates } = classify([a, b], KNOWN);

    assert.deepEqual(duplicates, []);
  });
});
