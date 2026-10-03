/**
 * Wall-clock helpers shared by the server and the browser.
 *
 * Here rather than in core because the schedule editor has to agree with the
 * scheduler about what "02:00 in Europe/London" means while the user is still
 * dragging — and the web app cannot import core. Core re-exports both, so the
 * maintenance window, quiet hours and the timeline read one implementation.
 */

/** `HH:MM` → minutes past midnight, or null if it isn't a time. */
export function parseClock(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes past midnight → `HH:MM`. Wraps, so 1440 is `00:00`. */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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
 * Does the runtime's ICU data recognise this timezone? An empty string is
 * "unset", which is valid — it means follow the server's own clock.
 */
export function isValidTimezone(value: string): boolean {
  if (value.trim() === "") return true;
  try {
    // Throws RangeError on an unknown zone — the same check croner performs.
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
