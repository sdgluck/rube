import { test } from "node:test";
import assert from "node:assert/strict";
import { meetsPinFloor, selectRotation, rotationState, type RotationCandidate } from "./rotation.ts";

/** Deterministic stand-in for the shuffle so selection is assertable. */
const noShuffle = <T>(items: T[]): T[] => items;

function candidates(sectionKey: string, names: string[]): RotationCandidate[] {
  return names.map((name) => ({ sectionKey, name, ratingKey: `rk-${name}` }));
}

test("selects the requested count", () => {
  const pool = candidates("1", ["a", "b", "c", "d", "e"]);
  const selected = selectRotation(pool, 3, {}, noShuffle);
  assert.equal(selected.length, 3);
});

test("selects everything when the pool is smaller than the count", () => {
  const pool = candidates("1", ["a", "b"]);
  const selected = selectRotation(pool, 10, {}, noShuffle);
  assert.deepEqual(
    selected.map((c) => c.name),
    ["a", "b"],
  );
});

test("does not overlap the previous rotation when the pool is big enough", () => {
  const pool = candidates("1", ["a", "b", "c", "d", "e", "f"]);
  const selected = selectRotation(pool, 3, { "1": ["a", "b", "c"] }, noShuffle);
  assert.deepEqual(
    selected.map((c) => c.name),
    ["d", "e", "f"],
  );
});

test("tops up from the previous rotation when there aren't enough fresh ones", () => {
  const pool = candidates("1", ["a", "b", "c", "d"]);
  const selected = selectRotation(pool, 3, { "1": ["a", "b", "c"] }, noShuffle);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].name, "d", "the one unpinned collection comes first");
  assert.deepEqual(selected.map((c) => c.name).slice(1), ["a", "b"]);
});

test("rotates per section, not across the whole rule", () => {
  const pool = [...candidates("1", ["a", "b", "c"]), ...candidates("2", ["x", "y", "z"])];
  const selected = selectRotation(pool, 2, { "1": ["a"] }, noShuffle);
  assert.deepEqual(
    selected.filter((c) => c.sectionKey === "1").map((c) => c.name),
    ["b", "c"],
  );
  assert.deepEqual(
    selected.filter((c) => c.sectionKey === "2").map((c) => c.name),
    ["x", "y"],
  );
});

test("consecutive rotations cycle the whole pool without repeats", () => {
  const pool = candidates("1", ["a", "b", "c", "d", "e", "f"]);
  const first = selectRotation(pool, 3, {}, noShuffle);
  const second = selectRotation(pool, 3, rotationState(first), noShuffle);
  const seen = new Set([...first, ...second].map((c) => c.name));
  assert.equal(seen.size, 6);
});

test("rotationState records the pinned names per section", () => {
  const selected = [...candidates("1", ["a", "b"]), ...candidates("2", ["x"])];
  assert.deepEqual(rotationState(selected), { "1": ["a", "b"], "2": ["x"] });
});

test("a real shuffle still respects the no-overlap rule", () => {
  const pool = candidates("1", ["a", "b", "c", "d", "e", "f"]);
  for (let i = 0; i < 50; i++) {
    const selected = selectRotation(pool, 3, { "1": ["a", "b", "c"] });
    assert.deepEqual(selected.map((c) => c.name).sort(), ["d", "e", "f"]);
  }
});

test("no pin floor set pins collections of any size", () => {
  assert.equal(meetsPinFloor(1, 0), true);
  assert.equal(meetsPinFloor(0, 0), true);
});

test("the pin floor is inclusive — exactly N items still pins", () => {
  assert.equal(meetsPinFloor(5, 5), true);
  assert.equal(meetsPinFloor(4, 5), false);
  assert.equal(meetsPinFloor(6, 5), true);
});
