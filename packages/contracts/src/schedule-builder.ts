/**
 * Cron's flexibility, without cron's syntax.
 *
 * `JobSchedule` covers the three shapes almost every job wants — daily, some
 * weekdays, a fixed interval — and the timeline is built on it. Everything
 * past that used to be a raw cron box: "the 1st and 15th", "the last Friday of
 * the month", "every 15 minutes during the working day", "only in December".
 * All ordinary requests; all requiring someone to know that `5#L` is a thing.
 *
 * This is the structured form of the rest. A cron string is read as three
 * independent questions — what time, which days, which months — each with a
 * small closed set of answers that map onto one cron field (or two) and back.
 * What can't be said that way (`5,35 2,14 …`: two minutes crossed with two
 * hours) parses to null and stays a raw expression; the builder never rewrites
 * a cron it cannot show faithfully.
 *
 * Day-of-month and day-of-week are never both restricted. Cron ORs them when
 * both are set — `0 3 L * 5` is every Friday *and* the last day — which is the
 * single most misread rule in the format, and no option here produces it.
 */
import { formatClock } from "./clock.ts";
import { describeDays, INTERVAL_STEPS } from "./job-schedule.ts";

export type BuilderTime =
  /** Minutes past midnight, sorted and distinct, never empty. */
  | { kind: "at"; times: number[] }
  /**
   * Repeating inside a window of whole hours, `from` to `to` inclusive. `to`
   * below `from` wraps past midnight. `minute` is the minute past each hour for
   * an hourly-or-slower repeat; a minutes repeat always starts on the hour.
   */
  | { kind: "repeat"; every: number; unit: "minute" | "hour"; from: number; to: number; minute: number };

export type Nth = 1 | 2 | 3 | 4 | 5 | "last";

export type BuilderDays =
  | { kind: "every" }
  /** 0 = Sunday … 6, sorted and distinct, never empty. */
  | { kind: "week"; days: number[] }
  /** Dates 1–31, sorted and distinct, plus the month's last day. At least one of the two. */
  | { kind: "month"; dates: number[]; last: boolean }
  | { kind: "nth"; nth: Nth; day: number };

export interface BuilderSchedule {
  time: BuilderTime;
  days: BuilderDays;
  /** 1 = January … 12, sorted and distinct, never empty. All twelve is every month. */
  months: number[];
}

export const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
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
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MON: Record<string, number> = Object.fromEntries(
  MONTH_NAMES.map((name, i) => [name.slice(0, 3).toUpperCase(), i + 1]),
);

/**
 * Minute steps for a repeat. Ones that divide the hour, for the reason given on
 * `INTERVAL_STEPS`: `*\/7` is not "every 7 minutes".
 */
export const REPEAT_MINUTE_STEPS = INTERVAL_STEPS.minute;
/**
 * Hour steps. Any, unlike minutes: inside a window `8-20/5` fires 08, 13, 18,
 * which is exactly "every 5 hours from 08:00 to 20:00" — there is no wrap to
 * leave an odd gap, because the window ends every day.
 */
export const REPEAT_HOUR_STEPS = [1, 2, 3, 4, 5, 6, 8, 12];

export const DEFAULT_BUILDER: BuilderSchedule = {
  time: { kind: "at", times: [120] },
  days: { kind: "every" },
  months: ALL_MONTHS,
};

// ─── Parsing ─────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function int(text: string, min: number, max: number, names?: Record<string, number>): number | null {
  const upper = text.toUpperCase();
  if (names && upper in names) return names[upper];
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** `1,3-5,7` → sorted distinct values, or null for anything with a step or a wildcard. */
function list(field: string, min: number, max: number, names?: Record<string, number>): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const ends = part.split("-");
    if (ends.length > 2) return null;
    const from = int(ends[0], min, max, names);
    const to = ends.length === 2 ? int(ends[1], min, max, names) : from;
    if (from === null || to === null || to < from) return null;
    for (let n = from; n <= to; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** An hour window: `*`, `9`, `9-17`, or the wrapped `22-23,0-5`. */
function hourWindow(field: string): { from: number; to: number } | null {
  if (field === "*") return { from: 0, to: 23 };
  const single = int(field, 0, 23);
  if (single !== null) return { from: single, to: single };
  const range = /^(\d{1,2})-(\d{1,2})$/.exec(field);
  if (range) {
    const from = int(range[1], 0, 23);
    const to = int(range[2], 0, 23);
    return from !== null && to !== null && from <= to ? { from, to } : null;
  }
  const wrapped = /^(\d{1,2})-23,0-(\d{1,2})$/.exec(field);
  if (wrapped) {
    const from = int(wrapped[1], 0, 23);
    const to = int(wrapped[2], 0, 23);
    return from !== null && to !== null && to < from ? { from, to } : null;
  }
  return null;
}

function parseTime(minute: string, hour: string): BuilderTime | null {
  // Every N minutes, all day or inside a window.
  const minuteStep = minute === "*" ? 1 : /^\*\/(\d+)$/.exec(minute)?.[1];
  if (minuteStep !== undefined) {
    const every = Number(minuteStep);
    if (every !== 1 && !REPEAT_MINUTE_STEPS.includes(every)) return null;
    const window = hourWindow(hour);
    return window ? { kind: "repeat", every, unit: "minute", ...window, minute: 0 } : null;
  }

  const minutes = list(minute, 0, 59);
  if (!minutes) return null;

  // Every N hours at :MM. `*` and a bare range are every hour.
  const hourStep = /^(\*|\d{1,2}-\d{1,2})\/(\d+)$/.exec(hour);
  if (hourStep || hour === "*" || /^\d{1,2}-\d{1,2}(,0-\d{1,2})?$/.test(hour)) {
    if (minutes.length !== 1) return null;
    const every = hourStep ? Number(hourStep[2]) : 1;
    if (!REPEAT_HOUR_STEPS.includes(every)) return null;
    const window = hourWindow(hourStep ? hourStep[1] : hour);
    // A stepped window must not wrap: croner applies the step to each range of
    // a list separately, so `22-23,0-5/2` is not "every 2 hours".
    if (!window || (every > 1 && window.to < window.from)) return null;
    return { kind: "repeat", every, unit: "hour", ...window, minute: minutes[0] };
  }

  // Specific times. Cron crosses its minute and hour lists, so a set of times
  // is only expressible when they share a minute or share an hour.
  const hours = list(hour, 0, 23);
  if (!hours) return null;
  if (minutes.length > 1 && hours.length > 1) return null;
  const times = hours.flatMap((h) => minutes.map((m) => h * 60 + m));
  return { kind: "at", times: [...new Set(times)].sort((a, b) => a - b) };
}

function parseDaysField(dom: string, dow: string): BuilderDays | null {
  if (dom === "*" && dow === "*") return { kind: "every" };

  if (dom === "*") {
    const nth = /^(\w{1,3})#([1-5]|L)$/i.exec(dow);
    if (nth) {
      const day = int(nth[1], 0, 7, DOW);
      if (day === null) return null;
      return { kind: "nth", nth: nth[2].toUpperCase() === "L" ? "last" : (Number(nth[2]) as Nth), day: day % 7 };
    }
    const days = list(dow, 0, 7, DOW);
    if (!days) return null;
    const distinct = [...new Set(days.map((d) => d % 7))].sort((a, b) => a - b);
    return distinct.length === 7 ? { kind: "every" } : { kind: "week", days: distinct };
  }

  if (dow !== "*") return null;
  const parts = dom.split(",");
  const last = parts.some((p) => p.toUpperCase() === "L");
  const rest = parts.filter((p) => p.toUpperCase() !== "L");
  const dates = rest.length > 0 ? list(rest.join(","), 1, 31) : [];
  if (!dates) return null;
  return { kind: "month", dates, last };
}

/** The builder form of `cron`, or null when it can't be shown without changing it. */
export function parseBuilder(cron: string): BuilderSchedule | null {
  const text = cron.trim();
  if (text === "") return null;
  let fields = (ALIASES[text.toLowerCase()] ?? text).split(/\s+/);
  // A leading zero seconds field is a five-field cron said at length; any
  // other seconds field is sub-minute, which this does not offer.
  if (fields.length === 6) {
    if (fields[0] !== "0") return null;
    fields = fields.slice(1);
  }
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;

  const time = parseTime(minute, hour);
  const days = parseDaysField(dom, dow);
  const months = month === "*" ? ALL_MONTHS : list(month, 1, 12, MON);
  if (!time || !days || !months || months.length === 0) return null;
  return { time, days, months };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function hours(from: number, to: number): string {
  if (from === 0 && to === 23) return "*";
  if (from === to) return String(from);
  return to > from ? `${from}-${to}` : `${from}-23,0-${to}`;
}

/** Collapse runs: `[1,2,3,5]` → `1-3,5`. Keeps a hand-typed range readable after an edit. */
function compact(values: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < values.length; i++) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    out.push(j - i >= 2 ? `${values[i]}-${values[j]}` : values.slice(i, j + 1).join(","));
    i = j;
  }
  return out.join(",");
}

/** Why `times` can't be one cron expression, or null when it can. */
export function timesError(times: number[]): string | null {
  if (times.length <= 1) return null;
  const minutes = new Set(times.map((t) => t % 60));
  const hourSet = new Set(times.map((t) => Math.floor(t / 60)));
  if (minutes.size === 1 || hourSet.size === 1) return null;
  return "Times in one schedule must share their minutes (02:30 and 14:30) or their hour (02:00 and 02:30).";
}

/** Why this builder state can't be saved, or null. */
export function builderError(s: BuilderSchedule): string | null {
  if (s.time.kind === "at") {
    if (s.time.times.length === 0) return "Add at least one time.";
    const err = timesError(s.time.times);
    if (err) return err;
  }
  if (s.time.kind === "repeat" && s.time.unit === "hour" && s.time.every > 1 && s.time.to < s.time.from) {
    return "A repeat of more than an hour can't run past midnight. End it at 23:00 or start after midnight.";
  }
  if (s.days.kind === "week" && s.days.days.length === 0) return "Pick at least one day.";
  if (s.days.kind === "month" && s.days.dates.length === 0 && !s.days.last) return "Pick at least one date.";
  if (s.months.length === 0) return "Pick at least one month.";
  return null;
}

export function formatBuilder(s: BuilderSchedule): string {
  let minute: string;
  let hour: string;
  if (s.time.kind === "at") {
    const mins = [...new Set(s.time.times.map((t) => t % 60))].sort((a, b) => a - b);
    const hrs = [...new Set(s.time.times.map((t) => Math.floor(t / 60)))].sort((a, b) => a - b);
    minute = mins.join(",");
    // Listed, never compacted to a range: `0 1-3` reads back as "every hour
    // from 01:00 to 03:00", and the picker would change mode under the user.
    hour = hrs.join(",");
  } else if (s.time.unit === "minute") {
    minute = s.time.every === 1 ? "*" : `*/${s.time.every}`;
    hour = hours(s.time.from, s.time.to);
  } else {
    minute = String(s.time.minute);
    const window = hours(s.time.from, s.time.to);
    hour = s.time.every === 1 ? window : `${window === "*" ? "*" : `${s.time.from}-${s.time.to}`}/${s.time.every}`;
  }

  let dom = "*";
  let dow = "*";
  if (s.days.kind === "week") dow = compact(s.days.days);
  if (s.days.kind === "nth") dow = `${s.days.day}#${s.days.nth === "last" ? "L" : s.days.nth}`;
  if (s.days.kind === "month") {
    dom = [...(s.days.dates.length ? [compact(s.days.dates)] : []), ...(s.days.last ? ["L"] : [])].join(",");
  }

  const month = s.months.length === 12 ? "*" : compact(s.months);
  return `${minute} ${hour} ${dom} ${month} ${dow}`;
}

// ─── Describing ──────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function and(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const NTH_WORDS: Record<string, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  last: "last",
};

function describeDaysPart(days: BuilderDays): string {
  switch (days.kind) {
    case "every":
      return "Every day";
    case "week":
      return describeDays(days.days);
    case "month":
      return `On the ${and([...days.dates.map(ordinal), ...(days.last ? ["last day"] : [])])}`;
    case "nth":
      return `On the ${NTH_WORDS[days.nth]} ${DAY_NAMES[days.day]}`;
  }
}

function describeTimePart(time: BuilderTime): string {
  if (time.kind === "at") return `at ${and(time.times.map(formatClock))}`;
  const every = time.every === 1 ? `every ${time.unit}` : `every ${time.every} ${time.unit}s`;
  const allDay = time.from === 0 && time.to === 23;
  if (time.unit === "hour") {
    const at = `at :${String(time.minute).padStart(2, "0")}`;
    if (allDay) return `${every} ${at}`;
    // The last fire, not the window's end: `8-20/5` stops at 18:00.
    const span = (time.to - time.from + 24) % 24;
    const last = (time.from + Math.floor(span / time.every) * time.every) % 24;
    return `${every} from ${formatClock(time.from * 60 + time.minute)} to ${formatClock(last * 60 + time.minute)}`;
  }
  if (allDay) return every;
  const lastMinute = 60 - time.every;
  return `${every} from ${formatClock(time.from * 60)} to ${formatClock(time.to * 60 + lastMinute)}`;
}

export function describeBuilder(s: BuilderSchedule): string {
  const months = s.months.length === 12 ? "" : `, in ${and(s.months.map((m) => MONTH_NAMES[m - 1]))}`;
  return `${describeDaysPart(s.days)} ${describeTimePart(s.time)}${months}`;
}

export const NTH_OPTIONS: Array<{ value: Nth; label: string }> = [1, 2, 3, 4, 5, "last"].map((n) => ({
  value: n as Nth,
  label: NTH_WORDS[n].replace(/^./, (c) => c.toUpperCase()),
}));
export { DAY_NAMES as WEEKDAY_NAMES };
