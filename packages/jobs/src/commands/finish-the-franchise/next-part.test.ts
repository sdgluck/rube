import { test } from "node:test";
import assert from "node:assert/strict";
import { franchiseSummary, nextPart } from "./next-part.ts";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const ALIEN = [
  { id: 1, title: "Alien", releaseDate: "1979-05-25" },
  { id: 2, title: "Aliens", releaseDate: "1986-07-18" },
  { id: 3, title: "Alien 3", releaseDate: "1992-05-22" },
  { id: 4, title: "Alien Resurrection", releaseDate: "1997-11-26" },
];
const seen = (...ids: number[]) => new Map(ids.map((id) => [id, { finished: true, started: true }]));
const all = new Set([1, 2, 3, 4]);

test("next is the part after the furthest one finished", () => {
  assert.deepEqual(nextPart(ALIEN, seen(1, 2), all, NOW), { part: ALIEN[2], resume: false });
  // Skipped from Alien to Alien 3: past Aliens, so Resurrection.
  assert.deepEqual(nextPart(ALIEN, seen(1, 3), all, NOW), { part: ALIEN[3], resume: false });
});

test("parts arrive in release order whatever order TMDb lists them in", () => {
  assert.deepEqual(nextPart([...ALIEN].reverse(), seen(1), all, NOW), { part: ALIEN[1], resume: false });
});

test("nothing for a series not started, or seen to the end", () => {
  assert.equal(nextPart(ALIEN, new Map(), all, NOW), null);
  assert.equal(nextPart(ALIEN, seen(4), all, NOW), null);
});

test("an unreleased or undated part is not next", () => {
  const parts = [
    { id: 1, title: "One", releaseDate: "2020-01-01" },
    { id: 2, title: "Two", releaseDate: "2027-06-01" },
    { id: 3, title: "Three" },
  ];
  assert.equal(nextPart(parts, seen(1), new Set([1, 2, 3]), NOW), null);
});

test("a gap in the library stops the series, unless told to skip it", () => {
  const without3 = new Set([1, 2, 4]);
  assert.deepEqual(nextPart(ALIEN, seen(1, 2), without3, NOW), { missing: ALIEN[2] });
  assert.deepEqual(nextPart(ALIEN, seen(1, 2), without3, NOW, { skipMissing: true }), {
    part: ALIEN[3],
    resume: false,
  });
});

test("a next part they started is a resume", () => {
  const watched = new Map([
    [1, { finished: true, started: true }],
    [2, { finished: false, started: true }],
  ]);
  assert.deepEqual(nextPart(ALIEN, watched, all, NOW), { part: ALIEN[1], resume: true });
});

test("franchiseSummary names a few and counts the rest", () => {
  assert.equal(franchiseSummary(["Alien 3"]), "The next film in series you've started. Next up: Alien 3.");
  assert.equal(
    franchiseSummary(["Alien 3", "Toy Story 2", "Shrek 2"]),
    "The next film in series you've started. Next up: Alien 3, Toy Story 2 and Shrek 2.",
  );
  assert.equal(
    franchiseSummary(["A", "B", "C", "D", "E"]),
    "The next film in series you've started. Next up: A, B, C and 2 more.",
  );
});
