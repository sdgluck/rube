import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeList, describeHoldings, providerSettingsPath, type ListPreviewItem } from "./lists.ts";

const HELD: ListPreviewItem = { title: "a", year: null, mediaType: "movie", plexRatingKey: "1", inArr: [] };
const WANTED: ListPreviewItem = { title: "b", year: null, mediaType: "movie", plexRatingKey: null, inArr: [{}] };
const MISSING: ListPreviewItem = { title: "c", year: null, mediaType: "movie", plexRatingKey: null, inArr: [] };

describe("describing a list", () => {
  test("names the owner, the size and the popularity", () => {
    assert.equal(describeList({ owner: "hdlists", itemCount: 300, likes: 12 }), "by hdlists · 300 items · 12 likes");
  });

  test("singularises rather than saying 1 items", () => {
    assert.equal(describeList({ owner: "", itemCount: 1, likes: 1 }), "1 item · 1 like");
  });

  /**
   * A lonely "0 likes" beside a name reads as a judgement on the list rather
   * than a fact about it, so it is left off entirely.
   */
  test("leaves zeroes off instead of stating them", () => {
    assert.equal(describeList({ owner: "someone", itemCount: 0, likes: 0 }), "by someone");
  });
});

describe("describing how much of a list you hold", () => {
  test("counts an *Arr holding as held, not only Plex", () => {
    assert.equal(describeHoldings([HELD, WANTED, MISSING], false), "You have 2 of all 3.");
  });

  test("says so when the whole list is already yours", () => {
    assert.equal(describeHoldings([HELD], false), "You already have all 1.");
  });

  test("says so when none of it is", () => {
    assert.equal(describeHoldings([MISSING, MISSING], false), "You have none of all 2.");
  });

  /**
   * The preview is capped server-side, so the count has to be honest about
   * what it counted — "24 of 100" on a 900-item list is otherwise a lie.
   */
  test("scopes the count to the page when the list was truncated", () => {
    assert.equal(describeHoldings([HELD, MISSING], true), "You have 1 of the first 2.");
  });

  test("an empty list says it is empty rather than that you have none of it", () => {
    assert.equal(describeHoldings([], false), "This list is empty.");
  });
});

describe("linking to a provider's settings", () => {
  test("points at the tab that holds its key", () => {
    assert.equal(providerSettingsPath("mdblist"), "/settings/databases/mdblist");
    assert.equal(providerSettingsPath("trakt"), "/settings/databases/trakt");
  });
});
