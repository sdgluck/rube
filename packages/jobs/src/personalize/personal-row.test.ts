/**
 * A person's row is only private while it doesn't carry the baseline label,
 * and only reaches them while it's pinned to the right Home — see the header
 * of `personal-row.ts` for the leak and the invisible rows this guards.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { personalRowLabels, personalRowPin } from "./personal-row.ts";

describe("personalRowLabels", () => {
  test("never the baseline label, which every restricted user's filter admits", () => {
    assert.deepEqual(personalRowLabels("alice", "Tinkerbell", "BecauseYouWatched"), [
      "BecauseYouWatched",
      "User:alice",
    ]);
  });
});

describe("personalRowPin", () => {
  test("a shared user's row goes on the shared Home, not the owner's", () => {
    assert.deepEqual(personalRowPin(false), {
      promotedToOwnHome: 0,
      promotedToRecommendedHome: 1,
      promotedToSharedHome: 1,
    });
  });

  test("the owner's row goes on their own Home", () => {
    assert.deepEqual(personalRowPin(true), {
      promotedToOwnHome: 1,
      promotedToRecommendedHome: 1,
      promotedToSharedHome: 0,
    });
  });
});
