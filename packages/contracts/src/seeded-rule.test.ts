import { test } from "node:test";
import assert from "node:assert/strict";
import { isSeededRule, SEEDED_RULE } from "./seeded-rule.ts";

test("recognises the rule the install plants", () => {
  assert.equal(isSeededRule({ ...SEEDED_RULE }), true);
});

test("a rule the user made is not the seed", () => {
  assert.equal(isSeededRule({ name: "90s Action", type: "smart_filter" }), false);
  // Same type, different name — an AI rule they wrote themselves.
  assert.equal(isSeededRule({ name: "Saturday Night", type: "ai_prompt" }), false);
  // Same name, different type — not the shape the seeder writes.
  assert.equal(isSeededRule({ name: SEEDED_RULE.name, type: "smart_filter" }), false);
});

test("renaming the seed makes it count as the user's", () => {
  assert.equal(isSeededRule({ name: "My AI Collections", type: SEEDED_RULE.type }), false);
});
