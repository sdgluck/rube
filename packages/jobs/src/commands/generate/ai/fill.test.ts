import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFromSeeds, type Nearest } from "./fill.ts";

const item = (k: string) => ({ ratingKey: k, title: k.toUpperCase() });
const library = ["a", "b", "c", "d", "e", "f", "g", "h"].map(item);

/** Ranks candidates alphabetically, recording what it was asked. */
function fakeNearest() {
  const calls: Parameters<Nearest>[0][] = [];
  const nearest: Nearest = (opts) => {
    calls.push(opts);
    return { ratingKeys: [...opts.candidates].sort().slice(0, opts.limit), coverage: { withVector: 1, total: 1 } };
  };
  return { nearest, calls };
}

const keys = (matched: { ratingKey: string }[]) => matched.map((m) => m.ratingKey);

test("examples lead, and the recommender fills to the maximum", () => {
  const { nearest } = fakeNearest();
  const [one] = fillFromSeeds([{ name: "One", matched: [item("g"), item("h")] }], library, 5, nearest);
  assert.deepEqual(keys(one.matched), ["g", "h", "a", "b", "c"]);
  assert.equal(one.seeds, 2);
});

test("titles one collection was filled with are withheld from the next", () => {
  const { nearest, calls } = fakeNearest();
  const [one, two] = fillFromSeeds(
    [
      { name: "One", matched: [item("h")] },
      { name: "Two", matched: [item("g")] },
    ],
    library,
    3,
    nearest,
  );
  assert.deepEqual(keys(one.matched), ["h", "a", "b"]);
  assert.deepEqual(keys(two.matched), ["g", "c", "d"]);
  assert.ok(!calls[1].candidates.includes("a"));
});

test("an example repeated by the model counts once", () => {
  const { nearest, calls } = fakeNearest();
  const [one] = fillFromSeeds([{ name: "One", matched: [item("h"), item("h")] }], library, 3, nearest);
  assert.deepEqual(keys(one.matched), ["h", "a", "b"]);
  assert.deepEqual(calls[0].seeds, ["h"]);
});

test("a declined fill keeps the examples and says why", () => {
  const [one] = fillFromSeeds([{ name: "One", matched: [item("h")] }], library, 3, () => ({
    skipped: "seed-has-no-vector",
  }));
  assert.deepEqual(keys(one.matched), ["h"]);
  assert.equal(one.skipped?.skipped, "seed-has-no-vector");
});

test("a theme with no matched examples is not filled from nowhere", () => {
  const { nearest, calls } = fakeNearest();
  const [one] = fillFromSeeds([{ name: "One", matched: [] }], library, 3, nearest);
  assert.deepEqual(one.matched, []);
  assert.equal(calls.length, 0);
});
