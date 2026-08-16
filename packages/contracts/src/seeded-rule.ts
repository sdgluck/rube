/**
 * The rule every fresh install starts with.
 *
 * In contracts rather than `domains/rules` because both sides need it and for
 * the same reason: the server derives onboarding progress from "has the user
 * added a rule", and the setup wizard has to say the same thing on screen. Two
 * copies of this predicate would let the Rules step show a tick and the words
 * "you have 1 rule" while disagreeing about which rule that is.
 */
export const SEEDED_RULE = { name: "AI Curated Collections", type: "ai_prompt" } as const;

/**
 * Whether a rule is the one the install planted rather than one the user
 * chose.
 *
 * Onboarding needs the distinction: "you have a rule" is trivially true on a
 * brand-new install, and a setup step that reports itself done before the user
 * has done anything is worse than no step at all.
 *
 * Matched on name *and* type rather than recorded on the row, which would need
 * a schema change to carry a flag that only one rule in the database will ever
 * have. The consequence is that renaming the seed makes it count as the
 * user's — which is the right answer, since they have engaged with it.
 */
export function isSeededRule(rule: { name: string; type: string }): boolean {
  return rule.name === SEEDED_RULE.name && rule.type === SEEDED_RULE.type;
}
