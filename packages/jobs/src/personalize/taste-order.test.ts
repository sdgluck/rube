import { test } from "node:test";
import assert from "node:assert/strict";
import { rankByGenreShare } from "./taste-order.ts";

test("rankByGenreShare puts the person's genres first and keeps order on ties", () => {
  const genres = new Map([
    ["horror", ["Horror"]],
    ["comedy", ["Comedy"]],
    ["family", ["Family", "Comedy"]],
  ]);
  const shares = [
    { name: "comedy", share: 0.6 },
    { name: "family", share: 0.3 },
  ];
  assert.deepEqual(rankByGenreShare(["horror", "comedy", "family"], genres, shares), ["family", "comedy", "horror"]);
});
