import { test } from "node:test";
import assert from "node:assert/strict";
import { SEASON_PRESETS } from "@rube/contracts";
import { bucketsFor, matchesBucket } from "./keyword-grouped.ts";

const christmas = () => bucketsFor("seasonal").find((b) => b.key === "seasonal:christmas")!;

test("seasonal buckets are the shared presets, under their old keys and labels", () => {
  // Rules filter on the labels with `includeValues`, so they must not drift.
  assert.deepEqual(
    bucketsFor("seasonal").map((b) => [b.key, b.label]),
    [
      ["seasonal:christmas", "Christmas"],
      ["seasonal:halloween", "Halloween"],
      ["seasonal:valentines", "Valentine's Day"],
      ["seasonal:thanksgiving", "Thanksgiving"],
      ["seasonal:new_year", "New Year's Eve"],
      ["seasonal:summer", "Summer"],
    ],
  );
  assert.equal(bucketsFor("seasonal").length, SEASON_PRESETS.length);
});

test("a December release with no Christmas keyword is not a Christmas film", () => {
  assert.equal(matchesBucket(christmas(), { keywords: [9882], releaseMonth: 12 }), false);
  assert.equal(matchesBucket(christmas(), { releaseMonth: 12 }), false);
});

test("a Christmas keyword matches whatever month the film came out", () => {
  assert.equal(matchesBucket(christmas(), { keywords: [207317], releaseMonth: 7 }), true);
  assert.equal(matchesBucket(christmas(), { keywords: [1, 260365] }), true);
});
