/**
 * Applies the importing user's per-import tweaks over a pack's published
 * config.
 *
 * A pack is authored blind: it can't know whether the target library has 40
 * directors or 4,000, or whether its owner wants their homepage rearranged
 * at all. So the published config is a starting point and this is where the
 * user's answer wins — once, at import, rather than as an edit to every rule
 * the pack just created.
 *
 * Each knob is applied only to rule types it means something for. Writing
 * `minItems` into a smart filter would parse fine and do nothing, which is
 * exactly the kind of dead config that makes a rule hard to reason about
 * later.
 */
import {
  isGroupedRuleType,
  producesManyCollections,
  ruleAction,
  type RegistryImportOverrides,
  type RuleAction,
} from "@tinkerbell/contracts";

export function applyImportOverrides(
  ruleType: string,
  config: Record<string, unknown>,
  overrides: RegistryImportOverrides | undefined,
): Record<string, unknown> {
  if (!overrides || Object.keys(overrides).length === 0) return config;

  const next = { ...config };
  const many = producesManyCollections(ruleType);
  // A cleanup rule's shelf is pinned `false` by the job whatever its config
  // says, so homepage answers are dead config there — same reason the wizard
  // stops asking for them once the outcome is cleanup.
  const pins = ruleAction(config as { action?: RuleAction }).kind === "collection";

  if (!pins) {
    // Nothing to decide, and nothing worth keeping if the pack shipped it.
    delete next.pinToHomepage;
    delete next.pinRotationCount;
    delete next.pinMinItems;
  } else if (overrides.pinToHomepage === false) {
    // Unpinning is unconditional — "don't touch my homepage" has to mean
    // every rule in the pack, not just the grouped ones.
    next.pinToHomepage = false;
    delete next.pinRotationCount;
    delete next.pinMinItems;
  } else if (overrides.pinToHomepage === true && many) {
    // Pinning is only offered for rules that rotate. Turning it on for a
    // single-collection rule is a per-rule decision, not a pack-wide one.
    next.pinToHomepage = true;
  }

  if (pins && next.pinToHomepage !== false && many && overrides.pinRotationCount !== undefined) {
    next.pinRotationCount = overrides.pinRotationCount;
  }

  // `limit` on a popular-people or franchises rule is a TMDb fetch budget,
  // not a collection cap — leave the pack's value alone there.
  if (overrides.limit !== undefined && isGroupedRuleType(ruleType)) {
    next.limit = overrides.limit;
  }

  if (overrides.minItems !== undefined && many) {
    next.minItems = overrides.minItems;
  }

  // A pin floor is meaningful for anything that pins, grouped or not — a
  // smart filter that matched two titles is as thin a homepage row as a
  // director with two films. It's dead config only on an unpinned rule.
  if (pins && overrides.pinMinItems !== undefined && next.pinToHomepage !== false) {
    next.pinMinItems = overrides.pinMinItems;
  }

  return next;
}

/** The keys the import modal (and the rule editor) let a user decide. */
const USER_OWNED_KEYS = ["pinToHomepage", "pinRotationCount", "pinMinItems", "limit", "minItems"] as const;

/**
 * Carries the user's answers forward across a pack update.
 *
 * These keys are asked about at import (or set in the rule editor, as
 * `pinMinItems` is) and editable afterwards, so on
 * this server they belong to the user, not the pack. A published bump can
 * change what a rule *matches* — new keywords, a rewritten filter — but it
 * must never re-pin a homepage somebody deliberately unpinned or re-cap a
 * rule they uncapped. Absence is an answer too: a rule imported without a
 * `limit` stays uncapped even if the pack starts shipping one.
 */
export function carryOverUserChoices(
  current: Record<string, unknown>,
  published: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...published };
  for (const key of USER_OWNED_KEYS) {
    if (key in current) next[key] = current[key];
    else delete next[key];
  }
  return next;
}
