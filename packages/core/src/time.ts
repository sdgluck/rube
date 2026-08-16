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

/** `HH:MM` → minutes past midnight, or null if it isn't a time. */
export function parseClock(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Minutes past midnight for `date`, read in `timezone`.
 *
 * The zone has to be applied here rather than by the caller: a window is a
 * statement about wall-clock time where the server is *configured* to live,
 * and reading it off a container running in UTC is how "quiet until 7am"
 * becomes "quiet until 2am" for anyone west of Greenwich.
 */
export function minutesOfDay(date: Date, timezone?: string): number {
  if (!timezone) return date.getHours() * 60 + date.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    // Intl renders midnight as 24 in some ICU versions under hour12: false.
    return (hour % 24) * 60 + minute;
  } catch {
    // An unknown zone falls back to the server clock rather than throwing —
    // see `isValidTimezone`; this is the same failing-open reasoning.
    return date.getHours() * 60 + date.getMinutes();
  }
}

/**
 * Is `now` inside the `from`–`to` window?
 *
 * A window whose end precedes its start spans midnight, which is the common
 * shape — 01:00 to 06:00 is easy, but 22:00 to 06:00 is what people actually
 * mean by "overnight".
 *
 * An unparseable window returns false: callers use this to *suppress*
 * something, and a typo in a time field must not silently silence every
 * notification on the server.
 */
export function isWithinClockWindow(from: string, to: string, now: Date, timezone?: string): boolean {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start == null || end == null) return false;
  if (start === end) return false;
  const minutes = minutesOfDay(now, timezone);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
