/**
 * Rule runs: the ledger of what each rule did, when, and what it changed.
 *
 * The pure halves — statuses, queue ordering, limits, test-result shaping —
 * stay plain module exports: they are functions of their arguments and have
 * nothing to inject. The two halves that read and write the database are
 * factories, composed here into the domain the container registers.
 */
import { token } from "@tinkerbell/container";
import type { Scope } from "@tinkerbell/container";
import type { Db } from "@tinkerbell/db";
import { createRuns } from "./runs.ts";
import { createChanges } from "./changes.ts";
import { createRuleRunQueue } from "./queue.ts";
import { createTestResults } from "./test-results.ts";

export * from "./statuses.ts";
export type { RuleRunPhase, RuleRunSummary, RuleRunTrigger } from "./runs.ts";
export { type PersistedTestResult } from "./test-results.ts";
export * from "./limits.ts";
export type {
  ChangesetMember,
  ChangeKind,
  CollectionDiff,
  RecordChangesInput,
  RunChangeGroup,
  RunChangeRow,
} from "./changes.ts";

export interface RuleRunsDeps {
  db: Db;
  scope: Scope;
}

export function createRuleRuns(deps: RuleRunsDeps) {
  return {
    ...createRuns(deps),
    ...createChanges(deps),
    ...createRuleRunQueue(deps),
    ...createTestResults(deps),
  };
}

export type RuleRuns = ReturnType<typeof createRuleRuns>;

export const RuleRunsToken = token<RuleRuns>("rule-runs");
