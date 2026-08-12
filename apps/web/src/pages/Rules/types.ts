export type SortKey = "name" | "type" | "enabled" | "lastRun";

export type EnabledFilter = "all" | "enabled" | "disabled";

export type RuleRow = {
  id: string;
  name: string;
  type: string;
  enabled: number;
  config: Record<string, unknown> | null;
  createdAt: number;
  lastCollectionRatingKey: string | null;
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
  lastRunCollectionCount: number | null;
  lastRunItemCount: number | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastTestAt: number | null;
  lastTestDurationMs: number | null;
  lastTestCollectionCount: number | null;
  lastTestItemCount: number | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  hasTestResult: boolean;
};
