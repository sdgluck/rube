/**
 * The `job_runs.status` vocabulary, in one place.
 *
 * `status` is free-text in the schema, so nothing at the database level stops
 * these sets drifting apart — and a query that forgets `cancelling` looks
 * exactly like one that predates it. Every caller that asks "is this run still
 * live?" or "is this run over?" should ask through here.
 *
 *   running    → a command is executing
 *   cancelling → cancellation requested; the command is still unwinding and
 *                still owns the row until it writes its own terminal status
 *   completed / failed / cancelled → terminal
 */

/** Statuses where a run is still executing and still occupies its job. */
export const ACTIVE_RUN_STATUSES = ["running", "cancelling"] as const;

/** Statuses where a run is over and its row must not be written again. */
export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"] as const;

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);
const ACTIVE_SET: ReadonlySet<string> = new Set(ACTIVE_RUN_STATUSES);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_SET.has(status);
}

export function isActiveStatus(status: string | null | undefined): boolean {
  return status != null && ACTIVE_SET.has(status);
}
