/**
 * Tunable timing/size constants for the job runner. Centralised so they're
 * named in one place and obvious to find when tuning.
 */

/** How long finished job runs are kept before `purge-runs` deletes them. */
export const JOB_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-job hard cap on retained runs in `jobRuns`. The purge-runs cron handles
 * age-based cleanup; this cap handles high-frequency jobs that would otherwise
 * accumulate thousands of rows between purges. */
export const JOB_RUN_KEEP_PER_JOB = 50;

/** Default `limit` injected into job configs that page over their data — UI
 * typically overrides this from settings. */
export const DEFAULT_JOB_RUN_LIMIT = 10;

/** Sidequest job runner: how often the per-run log/progress buffer is
 * flushed to SQLite. Lower = livelier UI; higher = fewer writes. */
export const JOB_LOG_FLUSH_INTERVAL_MS = 500;

/** How often the runner polls `jobRuns.status` to detect a "cancelled"
 * mutation from the API and abort the in-flight command. */
export const JOB_CANCEL_POLL_INTERVAL_MS = 1000;
