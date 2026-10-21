import { MINUTE_MS, WEEK_MS } from "@rube/core";

/**
 * Tunables for rule runs. Named separately from the job runner's `limits.ts`
 * rather than imported from it: `packages/jobs` depends on the domains, so
 * borrowing constants the other way would close a cycle. The values that mean
 * the same thing are deliberately kept the same.
 */

/** How often the buffered log/progress is flushed to SQLite. */
export const RULE_RUN_FLUSH_INTERVAL_MS = 500;

/** How often a live run re-reads its own row to notice a cancellation request. */
export const RULE_RUN_CANCEL_POLL_MS = 1000;

/** Per-rule cap on retained runs, applied on insert. */
export const RULE_RUN_KEEP_PER_RULE = 50;

/** How long finished rule runs are kept before `purge-runs` deletes them. */
export const RULE_RUN_RETENTION_MS = WEEK_MS;

/**
 * How long an active run may go without a heartbeat before the watchdog
 * declares it dead.
 *
 * The flush timer touches `updatedAt` every 500ms for as long as the run's
 * process is alive, whether or not the run itself is logging — so silence here
 * means the executor is gone, not that the rule is being quiet. Generous
 * anyway: a machine that just woke from sleep shouldn't lose a live run.
 */
export const RULE_RUN_HEARTBEAT_TIMEOUT_MS = 5 * MINUTE_MS;

/**
 * Hard cap on a single run's stored log; past it we keep a bounded tail.
 *
 * Counted with each line's time (`stampLog`), ~25 bytes a line: at the
 * typical 60–100-byte line that is a quarter fewer lines before the cap, which
 * still holds tens of thousands. Raise it if real runs start reaching it.
 */
export const RULE_RUN_LOG_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes of trailing log retained after the cap is hit. */
export const RULE_RUN_LOG_TAIL_BYTES = 64 * 1024;
