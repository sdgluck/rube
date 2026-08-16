/**
 * The `rule_runs.status` vocabulary, in one place.
 *
 * Mirrors `packages/jobs/src/statuses.ts` in spirit, with two differences that
 * are deliberate rather than accidental:
 *
 *   queued  → the run exists and is visible in the UI, but nothing is executing
 *             yet. Manual runs are serialised one at a time, and a rule waiting
 *             its turn should say so rather than look like nothing happened.
 *   ok / error / cancelled → the terminal set matches `rules.lastRunStatus`,
 *             so the denormalised summary on `rules` and the run row can never
 *             disagree about what a word means.
 */

/** Statuses where the run still owns its rule and may still write its row. */
export const ACTIVE_RULE_RUN_STATUSES = ["queued", "running", "cancelling"] as const;

/** Statuses where the run is over and its row must not be written again. */
export const TERMINAL_RULE_RUN_STATUSES = ["ok", "error", "cancelled"] as const;

export type RuleRunStatus = (typeof ACTIVE_RULE_RUN_STATUSES)[number] | (typeof TERMINAL_RULE_RUN_STATUSES)[number];

const ACTIVE_SET: ReadonlySet<string> = new Set(ACTIVE_RULE_RUN_STATUSES);
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RULE_RUN_STATUSES);

export function isRuleRunActive(status: string | null | undefined): boolean {
  return status != null && ACTIVE_SET.has(status);
}

export function isRuleRunTerminal(status: string | null | undefined): boolean {
  return status != null && TERMINAL_SET.has(status);
}

/** Statuses that produce output — what the UI polls a log for. */
export function isRuleRunLive(status: string | null | undefined): boolean {
  return status === "running" || status === "cancelling";
}
