// In-memory registry of in-flight test/run operations per rule.
// The web UI polls these to render progress.

import type { JobContext } from "@tinkerbell/core";

export type RulePhase = "test" | "run";

export interface RuleProgressState {
  ruleId: string;
  phase: RulePhase;
  startedAt: number;
  current: number;
  total: number;
  message: string;
  recentLogs: string[]; // last N log lines
}

export interface TestPreviewItem {
  title: string;
  year?: number;
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
}

const MAX_LOG_LINES = 30;

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
