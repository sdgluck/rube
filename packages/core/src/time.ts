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

// `parseClock` and `minutesOfDay` live in contracts so the browser's schedule
// editor and the scheduler read wall-clock time with one implementation.
export { parseClock, minutesOfDay } from "@rube/contracts";
import { minutesOfDay, parseClock } from "@rube/contracts";

/**
 * Midnight at the start of `now`'s day, as a timestamp.
 *
 * Derived by subtracting the wall-clock time already elapsed in `timezone`
 * rather than by constructing a date, which keeps it right across a DST
 * transition without any offset arithmetic. Falls back to the process clock for
 * an unset or unknown zone, as everything else here does.
 */
export function startOfLocalDay(now: number, timezone?: string): number {
  const date = new Date(now);
  if (!timezone) return date.setHours(0, 0, 0, 0);
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    // Intl renders midnight as 24 in some ICU versions under hour12: false.
    const elapsed = ((value("hour") % 24) * 3600 + value("minute") * 60 + value("second")) * 1000 + (now % 1000);
    return now - elapsed;
  } catch {
    return new Date(now).setHours(0, 0, 0, 0);
  }
}

/**
 * Midnight on the 1st of `now`'s month in `timezone`, as a timestamp.
 *
 * Steps back whole days from local midnight and re-snaps, rather than
 * subtracting `(day - 1) * DAY_MS` and trusting the result: across a DST change
 * that lands an hour either side of midnight, and an hour early is the last day
 * of the previous month. The half-day nudge keeps the re-snap inside the 1st.
 */
export function startOfLocalMonth(now: number, timezone?: string): number {
  const today = startOfLocalDay(now, timezone);
  let dayOfMonth: number;
  try {
    dayOfMonth = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric" }).format(now));
  } catch {
    dayOfMonth = new Date(now).getDate();
  }
  return startOfLocalDay(today - (dayOfMonth - 1) * DAY_MS + 12 * HOUR_MS, timezone);
}

/**
 * `YYYY-MM-DD` for `now` in `timezone` — a stable name for "which day is it",
 * for anything that needs to happen at most once a day.
 */
export function localDayKey(now: number, timezone?: string): string {
  const date = new Date(now);
  if (!timezone) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  try {
    // `en-CA` renders as YYYY-MM-DD, which is the shape we want anyway.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return localDayKey(now);
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
