import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSeason, parseSeasonAnswer, rankCandidates, rowId, rowIdentity } from "./match.ts";

test("matchSeason needs a keyword; the release month alone is nothing", () => {
  const christmas = new Set([207317, 260365]);
  assert.equal(matchSeason({ keywords: [260365] }, christmas), true);
  assert.equal(matchSeason({ keywords: [1], releaseMonth: 12 }, christmas), false);
  assert.equal(matchSeason(undefined, christmas), false);
});

test("rankCandidates orders by rating, then newest, then key — and drops repeats", () => {
  const info = new Map([
    ["a", { rating: 7, year: 2000 }],
    ["b", { rating: 8, year: 1990 }],
    ["c", { rating: 7, year: 2010 }],
    ["d", { rating: null, year: 2020 }],
  ]);
  assert.deepEqual(rankCandidates(["d", "a", "b", "c", "a"], info), ["b", "c", "a", "d"]);
});

test("rowIdentity reads the season and owner from a row's labels", () => {
  assert.deepEqual(rowIdentity(["Tinkerbell", "SeasonCollections", "Season:christmas"]), {
    season: "christmas",
    user: null,
  });
  assert.deepEqual(rowIdentity(["SeasonCollections", "Season:halloween", "User:alice"]), {
    season: "halloween",
    user: "alice",
  });
  assert.equal(rowIdentity(["SeasonCollections"]), null);
  assert.notEqual(rowId("christmas", null), rowId("christmas", "alice"));
});

test("parseSeasonAnswer takes the JSON asked for and nothing else", () => {
  assert.deepEqual(parseSeasonAnswer('Sure! {"items": ["Elf (2003)"]}'), ["Elf (2003)"]);
  assert.equal(parseSeasonAnswer("I can't help with that"), null);
  assert.equal(parseSeasonAnswer('{"titles": []}'), null);
});
