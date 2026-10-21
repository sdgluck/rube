import type { RuleRunsDeps } from "./index.ts";
import { perDeps } from "@rube/container";
/**
 * The most recent test *preview* for each rule, in memory.
 *
 * Deliberately not in `rule_runs`. A run row records what happened; this is the
 * payload a test produced — every candidate collection with its items and
 * thumbnails, which can be megabytes for a rule that matches a whole library.
 * It is worth exactly as much as the tab that asked for it, so it lives and
 * dies with the process, and the durable half of the test (status, duration,
 * log, progress) is the run row.
 */

export interface TestPreviewItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
}

export interface TestPreviewCollection {
  name: string;
  sectionTitle: string;
  items: TestPreviewItem[];
}

export interface PersistedTestResult {
  ruleId: string;
  finishedAt: number;
  durationMs: number;
  status: "ok" | "error" | "cancelled";
  collections: TestPreviewCollection[];
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  /**
   * For a cleanup rule: how many of the matched items would actually be
   * actioned on a real run, and how many are still building a streak. A
   * preview showing only the match count would hide the difference between
   * "800 matched, 3 due" and "3 matched, 3 due".
   */
  cleanup?: {
    mode: string;
    dryRun: boolean;
    consecutiveRuns: number;
    matched: number;
    dueThisRun: number;
    waiting: number;
    dueTitles: string[];
  };
  /**
   * For a metadata rule: the per-field diff a real run would write.
   *
   * Grouped by field as well as listed, because "change contentRating on 431
   * items" is the sentence someone needs before agreeing — and unlike a
   * collection there is no delete-and-re-run recovery if they agree wrongly.
   */
  metadata?: {
    dryRun: boolean;
    lock: boolean;
    matched: number;
    inspected: number;
    writes: number;
    items: number;
    blocked: number;
    byField: Array<{ field: string; count: number }>;
    diffs: Array<{
      ratingKey: string;
      itemTitle: string;
      field: string;
      currentValue: string;
      newValue: string;
      blocked: boolean;
    }>;
    truncated: boolean;
  };
  /**
   * For a smart filter: how many items each clause eliminated, per library.
   *
   * The single most valuable thing a test can say when the answer is zero —
   * without it, every clause in the rule is equally suspect.
   */
  funnel?: TestFunnelSection[];
}

export interface TestFunnelStep {
  label: string;
  remaining: number;
  removed: number;
  source: "plex" | "local";
}

export interface TestFunnelSection {
  sectionTitle: string;
  start: number;
  steps: TestFunnelStep[];
  final: number;
  mode: "narrowing" | "contributing";
}

export const createTestResults = perDeps(function createTestResults(_deps: RuleRunsDeps) {
  const lastTestResultByRule = new Map<string, PersistedTestResult>();

  function getLastTestResult(ruleId: string): PersistedTestResult | undefined {
    return lastTestResultByRule.get(ruleId);
  }

  function hasLastTestResult(ruleId: string): boolean {
    return lastTestResultByRule.has(ruleId);
  }

  function setLastTestResult(result: PersistedTestResult): void {
    lastTestResultByRule.set(result.ruleId, result);
  }

  function clearLastTestResult(ruleId: string): void {
    lastTestResultByRule.delete(ruleId);
  }

  return { getLastTestResult, hasLastTestResult, setLastTestResult, clearLastTestResult };
});
