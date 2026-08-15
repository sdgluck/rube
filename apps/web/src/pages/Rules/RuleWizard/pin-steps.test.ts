import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pinRotationError, rulePins, stepsFor } from "./rule-types.ts";
import { DEFAULT_OUTCOME_FORM, type RuleFormState } from "./types.ts";

/**
 * A cleanup rule's shelf is pinned `false` by the job whatever its config
 * says, so the wizard must not ask about the homepage on one — least of all
 * *require* an answer it will then ignore.
 */
// Only the pinning slice matters here, and importing the wizard's own
// EMPTY_FORM would drag the whole component tree in behind it.
const collectionRule = {
  type: "directors",
  pinToHomepage: true,
  pinRotationCount: 0,
  pinMinItems: 0,
  outcome: { ...DEFAULT_OUTCOME_FORM },
} as RuleFormState;

const cleanupRule = {
  ...collectionRule,
  outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup" as const, mode: "label" as const },
} as RuleFormState;

describe("rulePins", () => {
  it("is true only for a pinned collection rule", () => {
    assert.equal(rulePins({ ...collectionRule, pinToHomepage: true }), true);
    assert.equal(rulePins({ ...collectionRule, pinToHomepage: false }), false);
    assert.equal(rulePins({ ...cleanupRule, pinToHomepage: true }), false);
  });
});

describe("pinRotationError", () => {
  it("makes a grouped collection rule choose a rotation count", () => {
    const err = pinRotationError({ ...collectionRule, pinToHomepage: true, pinRotationCount: 0 });
    assert.match(err ?? "", /how many collections/i);
  });

  it("asks nothing of a cleanup rule, which never pins", () => {
    assert.equal(pinRotationError({ ...cleanupRule, pinToHomepage: true, pinRotationCount: 0 }), null);
  });
});

describe("stepsFor", () => {
  it("asks for the outcome before the scope it changes", () => {
    const ids = stepsFor("directors", "create").map((s) => s.id);
    assert.ok(ids.indexOf("outcome") < ids.indexOf("scope"), `outcome should precede scope, got ${ids.join(" → ")}`);
  });
});
