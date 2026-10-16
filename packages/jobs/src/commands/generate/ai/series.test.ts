import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesKey } from "./series.ts";

const same = (...titles: string[]) =>
  assert.deepEqual(
    new Set(titles.map(seriesKey)).size,
    1,
    `${titles.join(" / ")} → ${titles.map(seriesKey).join(" / ")}`,
  );
const different = (a: string, b: string) => assert.notEqual(seriesKey(a), seriesKey(b), `${a} / ${b}`);

test("a franchise's entries share a key", () => {
  same(
    "Harry Potter and the Philosopher's Stone",
    "Harry Potter and the Deathly Hallows: Part 2",
    "Harry Potter and the Goblet of Fire",
  );
  same(
    "The Land Before Time",
    "The Land Before Time VIII: The Big Freeze",
    "The Land Before Time XII: The Great Day of the Flyers",
  );
  same("Rocky", "Rocky IV: Rocky vs. Drago - Director's Cut");
  same("Paddington", "Paddington 2");
  same("Spider-Man: Into the Spider-Verse", "Spider-Man: No Way Home", "Spider-Man: Across the Spider-Verse");
  same("Dune: Part One", "Dune: Part Two");
  same("The Hunger Games", "The Hunger Games: Mockingjay - Part 2");
  same("Mission: Impossible", "Mission: Impossible - Fallout");
  same("Toy Story", "Toy Story 4");
  same("Joker", "Joker: Folie à Deux");
});

test("unrelated films keep their own keys", () => {
  different("Beauty and the Beast", "Beauty Shop");
  different("The Amazing Spider-Man 2", "Spider-Man: No Way Home");
  different("Before Sunrise", "Before Midnight");
  different("The Killer", "The Killing");
  different("Alien", "Aliens");
  different("Bicycle Thieves", "The Thief");
});
