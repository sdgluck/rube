import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionLimit, describeLimits, filterGroups, minItemsPerGroup } from "./limits.ts";

const GROUPS = [{ label: "Action" }, { label: "Comedy" }, { label: "Documentary" }];
const label = (g: { label: string }) => g.label;

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

test("describes the knobs for the run log", () => {
  assert.equal(describeLimits({}), "limit none, min-items none");
  assert.equal(describeLimits({ limit: 10, minItems: 3 }), "limit 10, min-items 3");
});

test("mentions include/exclude, because it explains a missing collection", () => {
  assert.match(describeLimits({ excludeValues: ["Documentary"] }), /excluding 1/);
  assert.match(describeLimits({ includeValues: ["Action", "Comedy"] }), /only 2 named group\(s\)/);
});

test("no include/exclude keeps every group", () => {
  assert.deepEqual(filterGroups(GROUPS, {}, label), GROUPS);
  // Empty arrays are "the user cleared the list", not "allow nothing".
  assert.deepEqual(filterGroups(GROUPS, { includeValues: [] }, label), GROUPS);
});

test("include keeps only the named groups", () => {
  assert.deepEqual(filterGroups(GROUPS, { includeValues: ["Action"] }, label), [{ label: "Action" }]);
});

test("exclude drops the named groups", () => {
  assert.deepEqual(filterGroups(GROUPS, { excludeValues: ["Documentary"] }, label), [
    { label: "Action" },
    { label: "Comedy" },
  ]);
});

test("matching ignores case and surrounding space", () => {
  // These lists get typed by hand and carried over from Kometa configs;
  // "documentary" failing to match "Documentary" would be a bug report.
  assert.deepEqual(filterGroups(GROUPS, { excludeValues: ["  documentary "] }, label), [
    { label: "Action" },
    { label: "Comedy" },
  ]);
});

test("a value on both lists is excluded", () => {
  assert.deepEqual(filterGroups(GROUPS, { includeValues: ["Action", "Comedy"], excludeValues: ["Comedy"] }, label), [
    { label: "Action" },
  ]);
});
