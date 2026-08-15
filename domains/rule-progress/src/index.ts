// In-memory registry of in-flight test/run operations per rule.
// The web UI polls these to render progress.

import { noopCheckpoint, type JobContext } from "@tinkerbell/core";

export type RulePhase = "test" | "run";

export interface RuleProgressState {
  ruleId: string;
  phase: RulePhase;
  startedAt: number;
  current: number;
  total: number;
  message: string;
  /** Log lines for the run so far, oldest first, capped at MAX_LOG_LINES. */
  recentLogs: string[];
}

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
}

/**
 * The UI shows the whole buffer in a scrollable pane, so this is a memory
 * bound rather than a display window — 30 was the latter and truncated the
 * start of any run worth reading. These states are per in-flight rule and are
 * dropped on completion, so a few hundred lines costs nothing; it stays capped
 * because a runaway rule logging in a loop shouldn't grow without limit.
 */
const MAX_LOG_LINES = 500;

const progressByRule = new Map<string, RuleProgressState>();
const lastTestResultByRule = new Map<string, PersistedTestResult>();

export function getRuleProgress(ruleId: string): RuleProgressState | undefined {
  return progressByRule.get(ruleId);
}

export function getAllRuleProgress(): Record<string, RuleProgressState> {
  return Object.fromEntries(progressByRule);
}

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

export function clearProgress(ruleId: string): void {
  progressByRule.delete(ruleId);
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** Build a JobContext that records progress + recent log lines into the registry. */
export function createTrackedContext(
  ruleId: string,
  phase: RulePhase,
  signal: AbortSignal,
  consolePrefix: string,
): JobContext {
  const state: RuleProgressState = {
    ruleId,
    phase,
    startedAt: Date.now(),
    current: 0,
    total: 0,
    message: "Starting…",
    recentLogs: [],
  };
  progressByRule.set(ruleId, state);

  return {
    signal,
    // Rule runs are per-rule slices of a job, with no `job_runs` row of their
    // own to resume from — there is nothing meaningful to checkpoint here.
    checkpoint: noopCheckpoint,
    log: (...args: unknown[]) => {
      const line = args.map(formatLogArg).join(" ");
      console.log(consolePrefix, ...args);
      state.recentLogs.push(line);
      if (state.recentLogs.length > MAX_LOG_LINES) {
        state.recentLogs.splice(0, state.recentLogs.length - MAX_LOG_LINES);
      }
      // Treat the most recent log line as the current message if no
      // explicit progress update has come through yet.
      state.message = line;
    },
    progress: (current, total, message) => {
      state.current = current;
      state.total = total;
      state.message = message;
    },
  };
}
