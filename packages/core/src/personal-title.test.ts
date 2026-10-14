import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { displayTitle, personalRowTitle } from "./personal-title.ts";

describe("personalRowTitle", () => {
  test("reads the same for everyone but differs per person", () => {
    const alice = personalRowTitle("We Think You'd Like", "alice");
    const bob = personalRowTitle("We Think You'd Like", "bob");
    assert.notEqual(alice, bob, "the same title would pool their rows' contents in Plex");
    assert.equal(displayTitle(alice), "We Think You'd Like");
    assert.equal(displayTitle(bob), "We Think You'd Like");
  });

  test("is stable across runs and case, so a row is found and kept rather than rebuilt", () => {
    assert.equal(
      personalRowTitle("Because you watched Silo", "Alice"),
      personalRowTitle("Because you watched Silo", "alice"),
    );
  });

  test("adds only invisible characters", () => {
    const suffix = personalRowTitle("X", "alice").slice(1);
    assert.equal(suffix.length, 32);
    assert.ok([...suffix].every((c) => c === String.fromCharCode(0x200b) || c === String.fromCharCode(0x200c)));
  });

  test("re-marking an already-marked title doesn't stack marks", () => {
    const once = personalRowTitle("Row", "alice");
    assert.equal(personalRowTitle(once, "alice"), once);
  });

  test("displayTitle leaves an ordinary title alone", () => {
    assert.equal(displayTitle("Because you watched Silo"), "Because you watched Silo");
  });
});
