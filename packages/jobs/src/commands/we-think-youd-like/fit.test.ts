/**
 * Two ways a real run on a local model came back with nothing: the library
 * didn't fit the model's window, so every Films call was refused, and the
 * answer that did come back named "The Crown (2019)" through "(2033)" for a
 * library's one "The Crown (2016)".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@rube/llm";
import type { PlexItem } from "@rube/plex";
import { libraryTitleMatcher } from "../ai-collection-shared.ts";
import { fitLibrary, pickRatingKeys } from "./index.ts";

const item = (ratingKey: string, title: string, year: number) => ({ ratingKey, title, year }) as PlexItem;

describe("fitLibrary", () => {
  const items = [
    item("1", "Quiet Drama", 2001),
    item("2", "Loud Action", 2002),
    item("3", "Seen Drama", 2003),
    item("4", "Other Drama", 2004),
    item("5", "Cartoon", 2005),
  ];
  const genresByKey = new Map([
    ["1", ["Drama"]],
    ["2", ["Action"]],
    ["3", ["Drama"]],
    ["4", ["Drama", "Mystery"]],
    ["5", ["Animation"]],
  ]);
  const lineCost = estimateTokens("Other Drama (2004) — Drama, Mystery\n");

  it("keeps the titles closest to their taste, leaves out what they've seen, in library order", () => {
    const fitted = fitLibrary({
      items,
      genresByKey,
      genreShares: [
        { name: "Drama", share: 0.6 },
        { name: "Mystery", share: 0.3 },
      ],
      watched: new Set(["3"]),
      budget: lineCost * 2,
    });
    assert.deepEqual(
      fitted.map((i) => i.ratingKey),
      ["1", "4"],
    );
  });

  it("keeps everything unseen when the budget allows", () => {
    const fitted = fitLibrary({ items, genresByKey, genreShares: [], watched: new Set(), budget: 100_000 });
    assert.equal(fitted.length, items.length);
  });
});

describe("libraryTitleMatcher", () => {
  it("matches a wrong year to the one title of that name", () => {
    const match = libraryTitleMatcher([item("10", "The Crown", 2016)]);
    assert.equal(match("The Crown (2016)"), "10");
    assert.equal(match("The Crown (2019)"), "10");
    assert.equal(match("The Crown"), "10");
  });

  it("won't guess between two titles sharing a name", () => {
    const match = libraryTitleMatcher([item("20", "Dune", 1984), item("21", "Dune", 2021)]);
    assert.equal(match("Dune (2021)"), "21");
    assert.equal(match("Dune (2000)"), undefined);
  });
});

describe("pickRatingKeys", () => {
  it("counts a run of invented years once", () => {
    const items = [item("10", "The Crown", 2016), item("11", "The Bear", 2022)];
    const picked = pickRatingKeys({
      items: ["The Bear (2022)", "The Crown (2019)", "The Crown (2020)", "The Crown (2021)", "Nowhere (2030)"],
      match: libraryTitleMatcher(items),
      watched: new Set(),
      excludedTitles: [],
      titleOf: new Map(items.map((i) => [i.ratingKey, i.title])),
      maxItems: 10,
    });
    assert.deepEqual(picked, ["11", "10"]);
  });
});
