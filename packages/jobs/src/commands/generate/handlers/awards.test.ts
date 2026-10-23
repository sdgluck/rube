/**
 * Reading OMDb's awards headline. Only wins count — "Nominated for 3 Oscars"
 * putting a film in "Academy Award Winners" would be worse than missing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { awardBucketsFor } from "./awards.ts";

const keys = (awards: string | null) => awardBucketsFor(awards).map((b) => b.key);

test("a film's Oscars, singular and plural", () => {
  assert.deepEqual(keys("Won 7 Oscars. 23 wins & 18 nominations total"), ["awards:oscar"]);
  assert.deepEqual(keys("Won 1 Oscar. 99 wins & 101 nominations total"), ["awards:oscar"]);
});

test("a show's Primetime Emmys", () => {
  assert.deepEqual(keys("Won 16 Primetime Emmys. 162 wins & 263 nominations total"), ["awards:emmy"]);
  assert.deepEqual(keys("Won 1 Primetime Emmy. 5 wins & 20 nominations total"), ["awards:emmy"]);
});

test("Golden Globes and BAFTAs, in the forms OMDb writes them", () => {
  assert.deepEqual(keys("Won 2 Golden Globes. 40 wins & 60 nominations total"), ["awards:golden_globe"]);
  assert.deepEqual(keys("Won 3 BAFTA Awards. 30 wins & 70 nominations total"), ["awards:bafta"]);
  assert.deepEqual(keys("Won 1 BAFTA Film Award. 10 wins total"), ["awards:bafta"]);
});

test("nominations, minor wins and no data are not winners", () => {
  assert.deepEqual(keys("Nominated for 3 Oscars. 12 wins & 40 nominations total"), []);
  assert.deepEqual(keys("Nominated for 1 Primetime Emmy. 2 wins & 4 nominations total"), []);
  assert.deepEqual(keys("4 wins & 10 nominations"), []);
  assert.deepEqual(keys(null), []);
});
