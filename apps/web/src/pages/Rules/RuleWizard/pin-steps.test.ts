import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { outcomeError, pinRotationError, rulePins, stepsFor } from "./rule-types.ts";
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
  it("asks a cleanup rule for its outcome before the scope it changes", () => {
    const ids = stepsFor("directors", "create", "cleanup").map((s) => s.id);
    assert.ok(ids.indexOf("outcome") < ids.indexOf("scope"), `outcome should precede scope, got ${ids.join(" → ")}`);
  });

  it("never shows a collection rule an outcome step — the page it was created on decided", () => {
    const ids = stepsFor("directors", "create").map((s) => s.id);
    assert.ok(!ids.includes("outcome"), `outcome should be absent, got ${ids.join(" → ")}`);
  });

  it("keeps the Look step for a collection rule and drops it for cleanup", () => {
    assert.ok(stepsFor("directors", "create").some((s) => s.id === "presentation"));
    assert.ok(!stepsFor("directors", "create", "cleanup").some((s) => s.id === "presentation"));
  });
});

/**
 * A metadata rule builds no collection, so it pins nothing and has no shelf to
 * describe — the same shape as cleanup, reached from a different page.
 */
const metadataRule = {
  ...collectionRule,
  outcome: {
    ...DEFAULT_OUTCOME_FORM,
    kind: "metadata" as const,
    set: { ...DEFAULT_OUTCOME_FORM.set, titleSort: "{sortableTitle}" },
  },
} as RuleFormState;

describe("stepsFor, metadata", () => {
  it("asks a metadata rule what to write before the scope it writes over", () => {
    const ids = stepsFor("directors", "create", "metadata").map((s) => s.id);
    assert.ok(ids.indexOf("outcome") < ids.indexOf("scope"), `outcome should precede scope, got ${ids.join(" → ")}`);
  });

  it("drops the Look step, which describes a collection it never builds", () => {
    assert.ok(!stepsFor("directors", "create", "metadata").some((s) => s.id === "presentation"));
  });
});

describe("outcomeError, metadata", () => {
  it("refuses a rule that would write nothing", () => {
    // Otherwise it runs nightly, matches a thousand items, does nothing, and
    // the only evidence is a log nobody reads.
    const blank = { ...metadataRule, outcome: { ...DEFAULT_OUTCOME_FORM, kind: "metadata" as const } } as RuleFormState;
    assert.match(outcomeError(blank) ?? "", /at least one field/i);
  });

  it("accepts a rule that only adds a tag", () => {
    const tagsOnly = {
      ...metadataRule,
      outcome: { ...DEFAULT_OUTCOME_FORM, kind: "metadata" as const, addLabels: ["Curated"] },
    } as RuleFormState;
    assert.equal(outcomeError(tagsOnly), null);
  });

  it("names the field whose template uses a token nobody implements", () => {
    const typo = {
      ...metadataRule,
      outcome: {
        ...DEFAULT_OUTCOME_FORM,
        kind: "metadata" as const,
        set: { ...DEFAULT_OUTCOME_FORM.set, title: "Marvel {titel}" },
      },
    } as RuleFormState;
    const err = outcomeError(typo) ?? "";
    assert.match(err, /title/);
    assert.match(err, /\{titel\}/);
  });

  it("accepts the templates people actually write", () => {
    assert.equal(outcomeError(metadataRule), null);
  });

  it("refuses a sort-title rule with no languages to strip articles for", () => {
    const noLangs = {
      ...metadataRule,
      outcome: { ...metadataRule.outcome, sortLanguages: [] },
    } as RuleFormState;
    assert.match(outcomeError(noLangs) ?? "", /language/i);
  });

  it("asks nothing of a collection rule", () => {
    assert.equal(outcomeError(collectionRule), null);
  });
});
