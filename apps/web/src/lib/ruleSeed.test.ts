import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { listSourceSeed } from "./ruleSeed.ts";

/**
 * The seed is the whole contract between Discover and the rule wizard, and it
 * travels as router state — so a field named wrong here fails as a blank
 * wizard field rather than as a type error.
 */
describe("seeding a rule from a list", () => {
  test("carries the provider and the numeric id the rule resolves by", () => {
    const seed = listSourceSeed({ provider: "trakt", listId: "8842", name: "Best of 2024" });
    assert.deepEqual(seed, {
      kind: "list_source",
      listProvider: "trakt",
      listId: "8842",
      collectionName: "Best of 2024",
    });
  });

  test("trims the name, which is what the collection ends up called", () => {
    assert.equal(listSourceSeed({ provider: "mdblist", listId: "1", name: "  Horror  " }).collectionName, "Horror");
  });
});
