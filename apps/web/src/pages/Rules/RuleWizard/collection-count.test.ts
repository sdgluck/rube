/**
 * What the wizard says a rule builds. A rule that builds one collection used
 * to offer to "pin generated collections" and rotate them; these pin the
 * wording that replaced that, per kind of rule and per scope.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildsOneCollection, collectionCountTag, describeCollectionCount } from "./rule-types.ts";

describe("collectionCountTag", () => {
  it("names the count before a scope is chosen", () => {
    assert.equal(collectionCountTag("smart_filter"), "One collection per library");
    assert.equal(collectionCountTag("seerr_requests"), "One collection");
    assert.equal(collectionCountTag("ai_prompt"), "Several collections per library");
    assert.equal(collectionCountTag("directors"), "A collection per director");
  });
});

describe("describeCollectionCount", () => {
  it("says one, and where, for a single-collection rule in one library", () => {
    assert.equal(describeCollectionCount("top_rated", 50, ["Films"]), "Builds one collection, in Films.");
  });

  it("says one in each when the scope spans libraries", () => {
    assert.equal(
      describeCollectionCount("smart_filter", 0, ["Films", "TV", "Anime"]),
      "Builds one collection in each of Films, TV and Anime.",
    );
  });

  it("reads an AI prompt's limit as collections, not items", () => {
    assert.equal(describeCollectionCount("ai_prompt", 5, ["Films"]), "Builds up to 5 collections, in Films.");
    assert.equal(describeCollectionCount("ai_prompt", 1, ["Films"]), "Builds one collection, in Films.");
  });

  it("puts Seerr requests in the first library only", () => {
    assert.equal(describeCollectionCount("seerr_requests", 50, ["Films", "TV"]), "Builds one collection, in Films.");
  });

  it("names the group for a grouped rule", () => {
    assert.equal(
      describeCollectionCount("studios", 0, ["Films", "TV"]),
      "Builds a collection for each studio in each of Films and TV.",
    );
  });
});

describe("buildsOneCollection", () => {
  it("is true only where a run can build no more than one", () => {
    assert.equal(buildsOneCollection("smart_filter", 0, 1), true);
    assert.equal(buildsOneCollection("smart_filter", 0, 2), false);
    assert.equal(buildsOneCollection("seerr_requests", 50, 3), true);
    assert.equal(buildsOneCollection("ai_prompt", 8, 1), false);
    assert.equal(buildsOneCollection("genres", 0, 1), false);
  });
});
