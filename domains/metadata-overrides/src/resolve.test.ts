import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normaliseTitle, resolveOverride, type ResolverIndex } from "./index.ts";

/**
 * The failure mode this guards against is specific and bad: matching an
 * override to the wrong film writes one title's hand-written summary onto
 * another. So the interesting cases are all the ones where refusing to answer
 * is the correct answer.
 */
const INDEX: ResolverIndex = {
  byImdb: new Map([["tt0084787", "rk-thing-1982"]]),
  byTmdb: new Map([[1891, "rk-empire"]]),
  byTitle: new Map([
    ["star wars", [{ ratingKey: "rk-starwars", year: 1977 }]],
    [
      "the thing",
      [
        { ratingKey: "rk-thing-1982", year: 1982 },
        { ratingKey: "rk-thing-2011", year: 2011 },
      ],
    ],
    [
      "untitled",
      [
        { ratingKey: "rk-a", year: undefined },
        { ratingKey: "rk-b", year: undefined },
      ],
    ],
  ]),
};

describe("resolving an override to an item", () => {
  test("an IMDb id wins outright", () => {
    // The config carried an id precisely because its author knew the title
    // wasn't enough, so the id must beat any title reading.
    assert.equal(resolveOverride(INDEX, { title: "Something Else Entirely", imdb: "tt0084787" }), "rk-thing-1982");
  });

  test("a TMDb id also wins", () => {
    assert.equal(resolveOverride(INDEX, { title: "Wrong", tmdb: 1891 }), "rk-empire");
  });

  test("an unambiguous title matches", () => {
    assert.equal(resolveOverride(INDEX, { title: "Star Wars" }), "rk-starwars");
  });

  test("title matching ignores case and punctuation", () => {
    assert.equal(resolveOverride(INDEX, { title: "star-wars!" }), "rk-starwars");
  });

  test("an ambiguous title with a year picks the right one", () => {
    assert.equal(resolveOverride(INDEX, { title: "The Thing", year: 1982 }), "rk-thing-1982");
    assert.equal(resolveOverride(INDEX, { title: "The Thing", year: 2011 }), "rk-thing-2011");
  });

  test("an ambiguous title with no year refuses to guess", () => {
    // This is the whole point. Two films called "The Thing" and no year is a
    // question, not a match — and answering it wrong is worse than not
    // applying the override at all.
    assert.equal(resolveOverride(INDEX, { title: "The Thing" }), null);
  });

  test("an ambiguous title with a year that matches neither also refuses", () => {
    assert.equal(resolveOverride(INDEX, { title: "The Thing", year: 1995 }), null);
  });

  test("candidates that are ambiguous even with a year refuse", () => {
    assert.equal(resolveOverride(INDEX, { title: "Untitled", year: 2000 }), null);
  });

  test("an unknown title is null", () => {
    assert.equal(resolveOverride(INDEX, { title: "Nothing Like This Exists" }), null);
  });

  test("an id that isn't in the library falls back to the title", () => {
    // A config can name an id for a film that was never added; the title is
    // still worth trying before giving up.
    assert.equal(resolveOverride(INDEX, { title: "Star Wars", imdb: "tt9999999" }), "rk-starwars");
  });
});

describe("title normalisation", () => {
  test("folds accents and punctuation the way the asset matcher does", () => {
    assert.equal(normaliseTitle("Amélie"), normaliseTitle("Amelie"));
    assert.equal(normaliseTitle("Alien: Covenant"), normaliseTitle("Alien - Covenant"));
  });

  test("keeps genuinely different titles apart", () => {
    assert.notEqual(normaliseTitle("Heat"), normaliseTitle("Heat 2"));
  });
});
