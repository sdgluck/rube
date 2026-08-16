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

const lastTestResultByRule = new Map<string, PersistedTestResult>();

export function getLastTestResult(ruleId: string): PersistedTestResult | undefined {
  return lastTestResultByRule.get(ruleId);
}

export function hasLastTestResult(ruleId: string): boolean {
  return lastTestResultByRule.has(ruleId);
}

export function setLastTestResult(result: PersistedTestResult): void {
  lastTestResultByRule.set(result.ruleId, result);
}

export function clearLastTestResult(ruleId: string): void {
  lastTestResultByRule.delete(ruleId);
}
