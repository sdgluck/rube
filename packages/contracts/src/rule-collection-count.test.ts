/**
 * The wizard says how many collections a rule builds and words its pin
 * options by the answer, so the answer has to match what the handlers do —
 * see each one's loop over `sections` in `packages/jobs/.../handlers/`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RULE_TYPE_VALUES, rotatesPins, ruleCollectionCount } from "./rule-config.ts";

describe("ruleCollectionCount", () => {
  test("a grouped rule builds one per group", () => {
    assert.deepEqual(ruleCollectionCount("directors"), { kind: "per-group" });
    assert.deepEqual(ruleCollectionCount("tmdb_franchises", 25), { kind: "per-group" });
  });

  test("Seerr requests builds one collection, whatever the scope", () => {
    assert.deepEqual(ruleCollectionCount("seerr_requests", 50), { kind: "one" });
  });

  test("an AI prompt builds up to its limit per library, 8 when unset", () => {
    assert.deepEqual(ruleCollectionCount("ai_prompt", 5), { kind: "up-to-per-library", max: 5 });
    assert.deepEqual(ruleCollectionCount("ai_prompt"), { kind: "up-to-per-library", max: 8 });
    assert.deepEqual(ruleCollectionCount("ai_prompt", 1), { kind: "one-per-library" });
  });

  test("a limit on a single-collection type caps its items, not its collections", () => {
    assert.deepEqual(ruleCollectionCount("top_rated", 50), { kind: "one-per-library" });
    assert.deepEqual(ruleCollectionCount("smart_filter"), { kind: "one-per-library" });
  });

  test("every rule type has an answer", () => {
    for (const type of RULE_TYPE_VALUES) assert.ok(ruleCollectionCount(type).kind, type);
  });
});

describe("rotatesPins", () => {
  test("only where a library can hold more than one of the rule's collections", () => {
    assert.equal(rotatesPins({ kind: "per-group" }), true);
    assert.equal(rotatesPins({ kind: "up-to-per-library", max: 8 }), true);
    assert.equal(rotatesPins({ kind: "one-per-library" }), false);
    assert.equal(rotatesPins({ kind: "one" }), false);
  });
});
