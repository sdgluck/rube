import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFromSeeds, MIN_COHESION, type Nearest } from "./fill.ts";

const item = (k: string) => ({ ratingKey: k, title: k.toUpperCase() });
const items = (...keys: string[]) => keys.map(item);
const library = items("a", "b", "c", "d", "e", "f", "g", "h", "i", "j");

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
  const [one] = fillFromSeeds([{ name: "One", matched: items("i", "j") }], library, 5, nearest);
  assert.deepEqual(keys(one.matched), ["i", "j", "a", "b", "c"]);
  assert.equal(one.seeds, 2);
});

test("titles one collection holds are withheld from the next", () => {
  const { nearest, calls } = fakeNearest();
  const [one, two] = fillFromSeeds(
    [
      { name: "One", matched: items("i", "j") },
      { name: "Two", matched: items("g", "h") },
    ],
    library,
    4,
    nearest,
  );
  assert.deepEqual(keys(one.matched), ["i", "j", "a", "b"]);
  assert.deepEqual(keys(two.matched), ["g", "h", "c", "d"]);
  assert.deepEqual(calls[1].candidates, ["c", "d", "e", "f"]);
});

test("an example counts once per run, and a theme left without enough is dropped", () => {
  // The qwen3 run: six themes seeded with the same three titles.
  const { nearest, calls } = fakeNearest();
  const [first, copy, partial] = fillFromSeeds(
    [
      { name: "Faded Echoes", matched: items("g", "h", "i") },
      { name: "Echoes of Time", matched: items("g", "h", "i") },
      { name: "Framed Reflections", matched: items("e", "f", "i") },
    ],
    library,
    4,
    nearest,
  );
  assert.equal(first.matched.length, 4);
  assert.deepEqual(copy.dropped, { reason: "examples", fresh: 0, reused: 3 });
  assert.deepEqual(copy.matched, []);
  // Two fresh examples are enough; the reused one is left out of it.
  assert.deepEqual(keys(partial.matched).slice(0, 2), ["e", "f"]);
  assert.ok(!keys(partial.matched).includes("i"));
  assert.equal(calls.length, 2);
});

test("a theme the AI gave a single example is dropped, not filled from one title", () => {
  const { nearest, calls } = fakeNearest();
  const [one] = fillFromSeeds([{ name: "One", matched: items("h", "h") }], library, 3, nearest);
  assert.deepEqual(one.dropped, { reason: "examples", fresh: 1, reused: 0 });
  assert.equal(calls.length, 0);
});

test("examples with nothing in common are dropped before they claim any titles", () => {
  const { nearest } = fakeNearest();
  const cohesion = (k: string[]) => (k.includes("i") ? MIN_COHESION - 0.01 : 0.5);
  const [scattered, next] = fillFromSeeds(
    [
      { name: "Scattered", matched: items("i", "j") },
      { name: "Next", matched: items("j", "h") },
    ],
    library,
    3,
    nearest,
    cohesion,
  );
  assert.equal(scattered.dropped?.reason, "scattered");
  // Its examples were never claimed, so the next theme may use them.
  assert.deepEqual(keys(next.matched), ["j", "h", "a"]);
});

test("unknown cohesion (too few vectors) doesn't drop a theme", () => {
  const { nearest } = fakeNearest();
  const [one] = fillFromSeeds([{ name: "One", matched: items("i", "j") }], library, 3, nearest, () => null);
  assert.equal(one.dropped, undefined);
});

test("a series takes at most two places in a theme", () => {
  const potter = (n: number) => ({ ratingKey: `hp${n}`, title: `Harry Potter and the Thing ${n}` });
  const lib = [...Array.from({ length: 8 }, (_, i) => potter(i)), ...items("x", "y", "z"), ...items("i", "j")];
  // The recommender ranks the whole franchise first.
  const nearest: Nearest = (opts) => ({
    ratingKeys: opts.candidates.filter((k) => k !== "i" && k !== "j"),
    coverage: { withVector: 1, total: 1 },
  });
  const [one] = fillFromSeeds([{ name: "One", matched: items("i", "j") }], lib, 7, nearest);
  assert.deepEqual(keys(one.matched), ["i", "j", "hp0", "hp1", "x", "y", "z"]);
  assert.equal(one.capped, 6);
});

test("a declined fill keeps the examples and says why", () => {
  const [one] = fillFromSeeds([{ name: "One", matched: items("i", "j") }], library, 3, () => ({
    skipped: "seed-has-no-vector",
  }));
  assert.deepEqual(keys(one.matched), ["i", "j"]);
  assert.equal(one.skipped?.skipped, "seed-has-no-vector");
});
