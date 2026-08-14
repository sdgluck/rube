/**
 * The action discriminator's defaults are load-bearing safety, not
 * convenience: a cleanup config that arrives without `dryRun` must come back
 * with it *on*, and a rule with no action at all must stay a collection rule
 * forever. Both are the kind of thing a later schema tidy-up could silently
 * invert.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEANUP_MODES,
  DEFAULT_CONSECUTIVE_RUNS,
  isCleanupRule,
  isDestructiveMode,
  ruleAction,
  ruleConfigSchema,
} from "./rule-config.ts";

test("a config with no action is a collection rule", () => {
  const parsed = ruleConfigSchema.parse({ collectionName: "Anything" });
  assert.equal(parsed.action, undefined);
  assert.deepEqual(ruleAction(parsed), { kind: "collection" });
  assert.equal(isCleanupRule(parsed), false);
});

test("an explicit collection action carries no cleanup knobs", () => {
  const parsed = ruleConfigSchema.parse({ action: { kind: "collection" } });
  assert.deepEqual(parsed.action, { kind: "collection" });
  assert.equal(isCleanupRule(parsed), false);
});

test("a cleanup action defaults to dry run", () => {
  // The single most important default in the feature. A destructive default
  // that has to be switched off is the only acceptable shape.
  const parsed = ruleConfigSchema.parse({ action: { kind: "cleanup", mode: "delete" } });
  assert.equal(parsed.action?.kind, "cleanup");
  assert.equal(parsed.action.kind === "cleanup" && parsed.action.dryRun, true);
});

test("a cleanup action defaults to a multi-run streak and a per-run cap", () => {
  const parsed = ruleConfigSchema.parse({ action: { kind: "cleanup", mode: "delete" } });
  assert.ok(parsed.action?.kind === "cleanup");
  assert.equal(parsed.action.consecutiveRuns, DEFAULT_CONSECUTIVE_RUNS);
  assert.ok(parsed.action.consecutiveRuns > 1, "acting on a single match must never be the default");
  assert.ok(parsed.action.maxActionsPerRun > 0);
  assert.equal(parsed.action.viaArr, true, "a Plex-only delete lets Radarr re-download it that night");
  assert.equal(parsed.action.addImportExclusion, false);
});

test("explicit values survive parsing", () => {
  const parsed = ruleConfigSchema.parse({
    action: { kind: "cleanup", mode: "unmonitor", consecutiveRuns: 7, maxActionsPerRun: 5, dryRun: false },
  });
  assert.ok(parsed.action?.kind === "cleanup");
  assert.equal(parsed.action.mode, "unmonitor");
  assert.equal(parsed.action.consecutiveRuns, 7);
  assert.equal(parsed.action.maxActionsPerRun, 5);
  assert.equal(parsed.action.dryRun, false);
});

test("a cleanup action requires a mode", () => {
  assert.equal(ruleConfigSchema.safeParse({ action: { kind: "cleanup" } }).success, false);
});

test("an unknown mode is rejected rather than defaulted", () => {
  // Falling back to a default here would mean a typo silently choosing an
  // action, and one of the choices deletes files.
  assert.equal(ruleConfigSchema.safeParse({ action: { kind: "cleanup", mode: "nuke" } }).success, false);
});

test("an unknown action kind is rejected", () => {
  assert.equal(ruleConfigSchema.safeParse({ action: { kind: "archive" } }).success, false);
});

test("consecutiveRuns cannot be zero or negative", () => {
  for (const consecutiveRuns of [0, -1]) {
    const parsed = ruleConfigSchema.safeParse({ action: { kind: "cleanup", mode: "delete", consecutiveRuns } });
    assert.equal(parsed.success, false, `consecutiveRuns ${consecutiveRuns} should be rejected`);
  }
});

test("maxActionsPerRun cannot be zero", () => {
  // Zero would read as "no cap" to a careless implementation.
  assert.equal(
    ruleConfigSchema.safeParse({ action: { kind: "cleanup", mode: "delete", maxActionsPerRun: 0 } }).success,
    false,
  );
});

test("the destructive set covers exactly the modes that touch files or *Arr", () => {
  assert.equal(isDestructiveMode("delete"), true);
  assert.equal(isDestructiveMode("unmonitor"), true);
  assert.equal(isDestructiveMode("label"), false);
  assert.equal(isDestructiveMode("collection_only"), false);
  for (const mode of CLEANUP_MODES) {
    assert.equal(typeof isDestructiveMode(mode), "boolean", `${mode} must be classified`);
  }
});

test("cleanup composes with the watch-history filter guard", () => {
  // The headline use case: "everyone has watched it, delete it". Both halves
  // of the config have to validate together.
  const parsed = ruleConfigSchema.safeParse({
    action: { kind: "cleanup", mode: "delete" },
    smartFilter: {
      kind: "group",
      combinator: "all",
      children: [
        { kind: "leaf", field: "tb.watchedByAll", op: "=", value: "1" },
        { kind: "leaf", field: "addedAt", op: "<=", value: "-1y" },
      ],
    },
  });
  assert.ok(parsed.success, parsed.error?.message);
});
