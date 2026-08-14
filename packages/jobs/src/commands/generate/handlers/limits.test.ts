import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionLimit, describeLimits, minItemsPerGroup } from "./limits.ts";

test("an unset limit builds every group", () => {
  assert.equal(collectionLimit({}), Number.POSITIVE_INFINITY);
  // Slicing by Infinity is how handlers apply it — must not truncate.
  assert.deepEqual(["a", "b"].slice(0, collectionLimit({})), ["a", "b"]);
});

test("a set limit caps the collection count", () => {
  assert.equal(collectionLimit({ limit: 10 }), 10);
});

test("limit 0 reads as off, not as 'build nothing'", () => {
  assert.equal(collectionLimit({ limit: 0 }), Number.POSITIVE_INFINITY);
});

test("an unset minItems keeps groups of any size, but never empty ones", () => {
  assert.equal(minItemsPerGroup({}), 1);
  assert.equal(minItemsPerGroup({ minItems: 0 }), 1);
});

test("a set minItems is the floor", () => {
  assert.equal(minItemsPerGroup({ minItems: 3 }), 3);
});

test("describes both knobs for the run log", () => {
  assert.equal(describeLimits({}), "limit none, min-items none");
  assert.equal(describeLimits({ limit: 10, minItems: 3 }), "limit 10, min-items 3");
});
