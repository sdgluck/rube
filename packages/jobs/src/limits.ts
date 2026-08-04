/**
 * Tunable timing/size constants for the job runner. Centralised so they're
 * named in one place and obvious to find when tuning.
 */

import { MINUTE_MS, WEEK_MS } from "@tinkerbell/core";

/** How long finished job runs are kept before `purge-runs` deletes them. */
export const JOB_RUN_RETENTION_MS = WEEK_MS;

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

/** How often the runner polls `jobRuns.status` to detect a "cancelling"
 * mutation from the API and abort the in-flight command. */
export const JOB_CANCEL_POLL_INTERVAL_MS = 1000;

/**
 * Grace period added on top of a command's budget before the run is force-failed.
 *
 * Aborting `ctx.signal` asks the command to unwind; a well-behaved one does so
 * quickly. This is how long we wait for that before declaring the worker wedged
 * and failing the run so the queue and the UI recover.
 */
export const JOB_TIMEOUT_GRACE_MS = MINUTE_MS;

/** How often the main process sweeps `job_runs` for runs past their deadline. */
export const JOB_WATCHDOG_INTERVAL_MS = MINUTE_MS;

/**
 * How long a run may sit in `cancelling` before the watchdog force-fails it.
 * A command that hasn't unwound within this window is not going to.
 */
export const JOB_CANCELLING_GRACE_MS = 2 * MINUTE_MS;

/**
 * Hard cap on a single run's stored log. Past this we stop appending and keep
 * only a bounded tail (flushed when the run ends), because the failure tail is
 * the part anyone actually reads.
 */
export const JOB_LOG_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes of trailing log retained after the cap is hit. */
export const JOB_LOG_TAIL_BYTES = 64 * 1024;

/** Checkpoints older than this are ignored on read, so stale state can never silently skip work. */
export const CHECKPOINT_TTL_MS = 24 * 60 * MINUTE_MS;
