import { test } from "node:test";
import assert from "node:assert/strict";
import { moreFromSummary, scorePeople } from "./people.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");
const details = new Map([
  [1, { directors: [{ id: 100, name: "Recent Director" }], cast: [{ id: 300, name: "Lead", order: 0 }] }],
  [2, { directors: [{ id: 100, name: "Recent Director" }], cast: [{ id: 301, name: "Cameo", order: 7 }] }],
  [3, { directors: [{ id: 200, name: "Old Director" }], cast: [{ id: 100, name: "Recent Director", order: 1 }] }],
  [4, { directors: [{ id: 200, name: "Old Director" }] }],
]);

test("two films watched this year outrank two from a decade ago", () => {
  const people = scorePeople(
    [
      { tmdbId: 1, lastPlayedAt: NOW - 10 * DAY },
      { tmdbId: 2, lastPlayedAt: NOW - 20 * DAY },
      { tmdbId: 3, lastPlayedAt: NOW - 3650 * DAY },
      { tmdbId: 4, lastPlayedAt: NOW - 3650 * DAY },
    ],
    details,
    NOW,
    { includeActors: true },
  );
  assert.deepEqual(
    people.slice(0, 2).map((p) => p.name),
    ["Recent Director", "Old Director"],
  );
  assert.ok(!people.some((p) => p.name === "Cameo"), "seventh billing is not a lead");
});

test("someone who directs and acts is a director, and a film counts once for them", () => {
  const people = scorePeople(
    [
      { tmdbId: 1, lastPlayedAt: NOW },
      { tmdbId: 3, lastPlayedAt: NOW },
    ],
    details,
    NOW,
    { includeActors: true },
  );
  const both = people.find((p) => p.id === 100)!;
  assert.equal(both.role, "director");
  assert.equal(both.seen.size, 2);
});

test("actors are left out when switched off", () => {
  const people = scorePeople([{ tmdbId: 1, lastPlayedAt: NOW }], details, NOW, { includeActors: false });
  assert.deepEqual(
    people.map((p) => p.name),
    ["Recent Director"],
  );
});

test("the summary says what kind of credit it is", () => {
  assert.equal(
    moreFromSummary({ name: "Ryan Gosling", role: "actor", seen: new Set([1, 2]) }),
    "Ryan Gosling: you've seen 2 of the films they star in. Here are the rest in the library.",
  );
});
