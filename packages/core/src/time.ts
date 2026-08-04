/**
 * Time constants in milliseconds. Use these instead of inline `24 * 60 * 60 * 1000`
 * expressions or per-domain duplicates.
 */
export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;
/** "Month" here is the rolling-window 30-day approximation, not a calendar month. */
export const MONTH_MS = 30 * DAY_MS;

/**
 * Human duration for job run summaries: `"42s"` under a minute, `"3m 7s"` above.
 *
 * The exact output shape is load-bearing — it is embedded verbatim in
 * `job.completed` event messages that users read in the activity feed, so
 * changing it changes history that's already been written. Pinned by a test.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
