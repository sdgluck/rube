/** Value lists, not bare unions: the URL params are validated against them. */
export const SORT_KEYS = ["name", "type", "enabled", "lastRun", "runs"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const ENABLED_FILTERS = ["all", "enabled", "disabled"] as const;
export type EnabledFilter = (typeof ENABLED_FILTERS)[number];

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
  /** How many runs and tests this rule has on record, and the latest one. */
  runCount: number;
  lastRunId: string | null;
  /** Set when the rule came from the public registry; null otherwise. */
  registryRuleSlug?: string | null;
  registryPackSlug?: string | null;
  registryVersion?: number | null;
};
