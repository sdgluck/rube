import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionInput } from "@rube/migrate";
import { isRubeOwned } from "./runtime.ts";

function input(labels: string[]): CollectionInput {
  return { ratingKey: "1", title: "A24 Productions", labels, sectionId: "1", sectionTitle: "Films" };
}

describe("isRubeOwned", () => {
  it("claims a collection stamped with a rule id", () => {
    // What generate writes on every collection it commits. Adopting one of
    // these was minting a second, disabled rule identical to the one that
    // built it — the whole rules list doubled after a migration.
    assert.equal(isRubeOwned(input(["Rube", "Rule:abc123"])), true);
  });

  it("claims the cleanup shelf", () => {
    assert.equal(isRubeOwned(input(["Rube", "Rule:abc123", "Rube:Cleanup"])), true);
  });

  it("leaves a user's own smart collection alone", () => {
    // The case migration exists to serve: no Rube labels at all.
    assert.equal(isRubeOwned(input([])), false);
    assert.equal(isRubeOwned(input(["Kometa", "Favourites"])), false);
  });

  it("does not read a user label that merely starts with the word Rule", () => {
    // `Rule:` with the colon is the stamp; "Rules of Engagement" is a film.
    assert.equal(isRubeOwned(input(["Rules of Engagement"])), false);
  });
});
