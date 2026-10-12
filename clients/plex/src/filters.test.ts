import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseShareFilter,
  composeShareFilter,
  getFilterClause,
  setFilterClause,
  shareFiltersEqual,
} from "./filters.ts";

/**
 * These are the tests that stop a content-rating edit from blanking somebody's
 * library. Personalization owns the `label=` clause of the same string an
 * admin's rating ceiling lives in, so every write has to edit one clause and
 * leave the other byte-identical.
 */
describe("share filter strings", () => {
  it("reads a single clause with comma-separated values", () => {
    assert.deepEqual(getFilterClause("label=Tinkerbell,User:sam", "label"), ["Tinkerbell", "User:sam"]);
  });

  it("separates clauses on the pipe", () => {
    const raw = "contentRating=PG,PG-13|label=Tinkerbell,User:sam";
    assert.deepEqual(getFilterClause(raw, "contentRating"), ["PG", "PG-13"]);
    assert.deepEqual(getFilterClause(raw, "label"), ["Tinkerbell", "User:sam"]);
  });

  // The form this repo used to write. Plex enforces only the first label, so
  // reading it any other way would hide the drift from reconcile.
  it("reads the old pipe-separated label form as Plex enforces it", () => {
    assert.deepEqual(getFilterClause("label=Tinkerbell|User:sam", "label"), ["Tinkerbell"]);
    assert.equal(
      setFilterClause("label=Tinkerbell|User:sam", "label", ["Tinkerbell", "User:sam"]),
      "label=Tinkerbell,User:sam",
    );
  });

  it("round-trips", () => {
    const raw = "contentRating=PG,PG-13|label=Tinkerbell,User:sam";
    assert.equal(composeShareFilter(parseShareFilter(raw)), raw);
  });

  it("keeps an exclusion clause apart from an inclusion one", () => {
    const raw = "label!=Kids|label=Tinkerbell";
    assert.deepEqual(getFilterClause(raw, "label!"), ["Kids"]);
    assert.deepEqual(getFilterClause(raw, "label"), ["Tinkerbell"]);
    assert.equal(composeShareFilter(parseShareFilter(raw)), raw);
  });

  it("returns nothing for an absent clause, and for an empty string", () => {
    assert.deepEqual(getFilterClause("label=Kids", "contentRating"), []);
    assert.deepEqual(getFilterClause("", "label"), []);
    assert.deepEqual(getFilterClause(undefined, "label"), []);
  });

  it("replaces one clause and leaves the other exactly as it found it", () => {
    const before = "contentRating=PG|label=Tinkerbell,User:sam";
    const after = setFilterClause(before, "contentRating", ["PG-13", "R"]);
    assert.equal(after, "contentRating=PG-13,R|label=Tinkerbell,User:sam");
    assert.deepEqual(getFilterClause(after, "label"), ["Tinkerbell", "User:sam"]);
  });

  it("adds a clause that wasn't there", () => {
    assert.equal(setFilterClause("label=Kids", "contentRating", ["G"]), "label=Kids|contentRating=G");
  });

  // A present-but-empty clause is "match nothing" to Plex, which is how a
  // library goes dark. Clearing has to remove the clause outright.
  it("drops the clause entirely when cleared", () => {
    assert.equal(setFilterClause("contentRating=PG|label=Kids", "contentRating", []), "label=Kids");
    assert.equal(setFilterClause("contentRating=PG", "contentRating", []), "");
    assert.equal(setFilterClause("label=Kids", "label", ["", "  "]), "");
  });

  it("ignores surrounding whitespace on values", () => {
    assert.equal(setFilterClause("", "label", [" Kids ", "Teen"]), "label=Kids,Teen");
  });

  it("compares clause sets regardless of order", () => {
    assert.ok(shareFiltersEqual("label=A,B|contentRating=PG", "contentRating=PG|label=B,A"));
    assert.ok(!shareFiltersEqual("label=A", "label=A,B"));
    assert.ok(shareFiltersEqual("", undefined));
  });
});
