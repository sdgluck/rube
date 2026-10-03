/**
 * The rule window's `MM-DD` strings, as the month and day a person picks.
 *
 * The window used to be two text boxes and a hint explaining the format. Two
 * selects can't produce "13-01" or "Oct 1", so the format needs no explaining;
 * this is the conversion either side of them. The day is clamped to the month
 * rather than rejected, so switching March 31 to April lands on April 30
 * instead of a value the schema refuses on save. February keeps its 29th: the
 * window is year-less, and a leap-day window is a real (if rare) request.
 */

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface MonthDay {
  /** 1–12. */
  month: number;
  /** 1–31, within the month. */
  day: number;
}

export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** `"10-31"` → `{ month: 10, day: 31 }`; anything unparseable → 1 January. */
export function parseMonthDay(value: string): MonthDay {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  const month = match ? Number(match[1]) : 1;
  const day = match ? Number(match[2]) : 1;
  if (month < 1 || month > 12) return { month: 1, day: 1 };
  return { month, day: Math.min(Math.max(day, 1), daysInMonth(month)) };
}

/** `{ month: 4, day: 31 }` → `"04-30"`. */
export function formatMonthDay({ month, day }: MonthDay): string {
  const m = Math.min(Math.max(Math.round(month), 1), 12);
  const d = Math.min(Math.max(Math.round(day), 1), daysInMonth(m));
  return `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
