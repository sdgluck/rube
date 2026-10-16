import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCollections } from "./select.ts";

const item = (k: string | number) => ({ ratingKey: String(k), title: `T${k}` });
const items = (...keys: (string | number)[]) => keys.map(item);
const range = (from: number, to: number) => items(...Array.from({ length: to - from }, (_, i) => from + i));

test("titles repeated to reach the minimum do not count towards it", () => {
  // The qwen3 run behind this: six films, four of them listed twice, as ten.
  const [verdict] = selectCollections([{ name: "Echoed Silence", matched: items(1, 2, 3, 4, 5, 6, 1, 2, 3, 4) }], 10);
  assert.deepEqual(verdict, { kind: "too-few", name: "Echoed Silence", distinct: 6 });
});

test("a kept collection is deduplicated", () => {
  const [verdict] = selectCollections([{ name: "A", matched: [...range(0, 10), item(3)] }], 10);
  assert.equal(verdict.kind, "keep");
  assert.equal(verdict.kind === "keep" && verdict.matched.length, 10);
});

test("a collection that mostly repeats an earlier one is dropped", () => {
  const verdicts = selectCollections(
    [
      { name: "Echoes of Time", matched: range(0, 18) },
      { name: "Echoes of the Past", matched: range(0, 17) },
      { name: "Something Else", matched: range(100, 115) },
    ],
    10,
  );
  assert.deepEqual(
    verdicts.map((v) => v.kind),
    ["keep", "duplicate", "keep"],
  );
  assert.deepEqual(verdicts[1], { kind: "duplicate", name: "Echoes of the Past", of: "Echoes of Time", shared: 17 });
});

test("overlap is measured against the smaller roster", () => {
  // Wholly inside a bigger list is a repeat even though it is a third of it.
  const verdicts = selectCollections(
    [
      { name: "Big", matched: range(0, 30) },
      { name: "Subset", matched: range(0, 10) },
    ],
    10,
  );
  assert.equal(verdicts[1].kind, "duplicate");
});

test("some shared titles are allowed", () => {
  const verdicts = selectCollections(
    [
      { name: "A", matched: range(0, 10) },
      { name: "B", matched: [...range(5, 10), ...range(50, 55)] },
    ],
    10,
  );
  assert.deepEqual(
    verdicts.map((v) => v.kind),
    ["keep", "keep"],
  );
});

test("a dropped collection is not what later ones are compared against", () => {
  const verdicts = selectCollections(
    [
      { name: "Short", matched: range(0, 5) },
      { name: "Full", matched: range(0, 10) },
    ],
    10,
  );
  assert.deepEqual(
    verdicts.map((v) => v.kind),
    ["too-few", "keep"],
  );
});
