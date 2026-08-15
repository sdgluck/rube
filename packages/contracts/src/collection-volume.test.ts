/**
 * The estimate is a heuristic, so the tests pin the properties that make it
 * useful rather than the numbers it happens to produce: that the type which
 * actually broke a run lands in the "severe" band, that raising the floor
 * moves the number down, and that every grouped type has an answer at all.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTERNAL_GROUP_RULE_TYPES, GROUPED_RULE_TYPES } from "./rule-config.ts";
import {
  approximateCount,
  defaultMinItemsForRuleType,
  estimateCollectionCount,
  minItemsOnByDefault,
  volumeLevel,
} from "./collection-volume.ts";

/** The library that prompted all this: 4,165 films, 5,391 studio groups. */
const REAL_LIBRARY = 4165;

describe("estimateCollectionCount", () => {
  it("puts an unfloored studios rule on a real library in the severe band", () => {
    const estimate = estimateCollectionCount({
      type: "studios",
      libraryItems: REAL_LIBRARY,
      minItems: 0,
      limit: 0,
    });
    assert.ok(estimate !== null);
    // The run that failed produced 5,391. Being within a factor of two of that
    // is all the estimate promises.
    assert.ok(estimate > 2500 && estimate < 11000, `expected a few thousand, got ${estimate}`);
    assert.equal(volumeLevel(estimate), "severe");
  });

  it("brings that same rule back into the ok band at its default floor", () => {
    const estimate = estimateCollectionCount({
      type: "studios",
      libraryItems: REAL_LIBRARY,
      minItems: defaultMinItemsForRuleType("studios"),
      limit: 0,
    });
    assert.ok(estimate !== null);
    assert.equal(volumeLevel(estimate), "ok");
  });

  it("falls monotonically as the floor rises", () => {
    const at = (minItems: number) =>
      estimateCollectionCount({ type: "actors", libraryItems: REAL_LIBRARY, minItems, limit: 0 })!;
    for (let floor = 1; floor < 10; floor++) {
      assert.ok(at(floor) >= at(floor + 1), `floor ${floor} should not undercount floor ${floor + 1}`);
    }
  });

  it("never exceeds an explicit collection cap", () => {
    const estimate = estimateCollectionCount({
      type: "studios",
      libraryItems: REAL_LIBRARY,
      minItems: 0,
      limit: 25,
    });
    assert.equal(estimate, 25);
  });

  it("keeps bounded types bounded however big the library gets", () => {
    const estimate = estimateCollectionCount({ type: "decades", libraryItems: 500_000, minItems: 0, limit: 0 });
    assert.ok(estimate !== null && estimate <= 15, `decades should stay small, got ${estimate}`);
    assert.equal(volumeLevel(estimate), "ok");
  });

  it("takes a TMDb-sourced rule's fetch budget as the answer", () => {
    assert.equal(
      estimateCollectionCount({ type: "tmdb_popular_directors", libraryItems: REAL_LIBRARY, minItems: 3, limit: 10 }),
      10,
    );
  });

  it("has nothing to say about rules that build one collection", () => {
    assert.equal(
      estimateCollectionCount({ type: "smart_filter", libraryItems: REAL_LIBRARY, minItems: 0, limit: 0 }),
      null,
    );
  });

  it("declines to guess without a library size", () => {
    assert.equal(estimateCollectionCount({ type: "studios", libraryItems: 0, minItems: 0, limit: 0 }), null);
  });

  it("answers for every grouped rule type", () => {
    for (const type of [...GROUPED_RULE_TYPES, ...EXTERNAL_GROUP_RULE_TYPES]) {
      const estimate = estimateCollectionCount({ type, libraryItems: REAL_LIBRARY, minItems: 0, limit: 25 });
      assert.ok(estimate !== null && estimate > 0, `no estimate for "${type}"`);
    }
  });
});

describe("defaultMinItemsForRuleType", () => {
  it("floors the types that fan out per item, and leaves the small ones alone", () => {
    for (const type of ["actors", "directors", "studios", "networks"]) {
      assert.ok(minItemsOnByDefault(type), `"${type}" should start with a floor`);
    }
    for (const type of ["genres", "decades", "resolutions", "content_ratings"]) {
      assert.equal(minItemsOnByDefault(type), false, `"${type}" should not need a floor`);
    }
  });

  it("keeps every grouped type out of the warn band at its own default", () => {
    for (const type of GROUPED_RULE_TYPES) {
      const estimate = estimateCollectionCount({
        type,
        libraryItems: REAL_LIBRARY,
        minItems: defaultMinItemsForRuleType(type),
        limit: 0,
      });
      assert.equal(volumeLevel(estimate), "ok", `"${type}" warns at its own default floor`);
    }
  });
});

describe("approximateCount", () => {
  it("rounds hard enough that nobody reads it as exact", () => {
    assert.equal(approximateCount(7), "7");
    assert.equal(approximateCount(43), "40");
    assert.equal(approximateCount(212), "200");
    assert.equal(approximateCount(5391), "5,500");
  });
});
