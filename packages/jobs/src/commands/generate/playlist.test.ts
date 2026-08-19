import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyOrder, playlistMarker } from "./playlist.ts";

/**
 * Order is the entire difference between a playlist and a collection, so it's
 * the thing worth pinning down — particularly the default, which must not
 * quietly re-sort what the source already ordered.
 */
const ITEMS = [
  { ratingKey: "3", title: "Casablanca", year: 1942 },
  { ratingKey: "1", title: "Alien", year: 1979 },
  { ratingKey: "2", title: "Blade Runner", year: 1982 },
];

describe("playlist ordering", () => {
  test("the default keeps the source's own order", () => {
    // A list source's order is the reason somebody asked for a playlist. Any
    // re-sorting here would silently throw it away.
    assert.deepEqual(applyOrder(ITEMS, "handler"), ITEMS);
  });

  test("doesn't mutate the array it was given", () => {
    const input = [...ITEMS];
    applyOrder(input, "title");
    assert.deepEqual(input, ITEMS);
  });

  test("sorts alphabetically", () => {
    assert.deepEqual(
      applyOrder(ITEMS, "title").map((i) => i.title),
      ["Alien", "Blade Runner", "Casablanca"],
    );
  });

  test("sorts oldest first by year", () => {
    assert.deepEqual(
      applyOrder(ITEMS, "release_date").map((i) => i.year),
      [1942, 1979, 1982],
    );
  });

  test("reverses for recently-added", () => {
    assert.deepEqual(
      applyOrder(ITEMS, "added_date").map((i) => i.ratingKey),
      ["2", "1", "3"],
    );
  });

  test("shuffling keeps every item exactly once", () => {
    const shuffled = applyOrder(ITEMS, "random");
    assert.equal(shuffled.length, ITEMS.length);
    assert.deepEqual(shuffled.map((i) => i.ratingKey).sort(), ["1", "2", "3"]);
  });

  test("an order this build doesn't know falls back to the source's", () => {
    // A config written by a newer version must not scramble somebody's
    // playlist just because this build can't read one field.
    assert.deepEqual(applyOrder(ITEMS, "invented" as "handler"), ITEMS);
  });

  test("an empty selection is fine", () => {
    assert.deepEqual(applyOrder([], "title"), []);
  });
});

describe("ownership marker", () => {
  test("carries the rule id, so ownership survives losing the table", () => {
    // Playlists can't be labelled, so the summary is the only place in Plex
    // where ownership can be written down at all.
    assert.equal(playlistMarker("abc-123"), "[tinkerbell:abc-123]");
  });
});
