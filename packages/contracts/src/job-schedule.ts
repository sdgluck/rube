/**
 * A job's schedule as something a person can reason about.
 *
 * The scheduler stores cron strings and that does not change: croner is what
 * fires, and a cron string is what the portable export carries. But "0 1 * * *"
 * is not something you can drag along a timeline, and the old editor — a text
 * box per job, on each job's own page — gave no view of how the night fitted
 * together. So the schedule page works on this structured form and turns it back
 * into cron on save.
 *
 * Anything that does not fit one of the shapes is `custom` and keeps its text
 * verbatim. A round trip must never rewrite a cron the user typed into a
 * different expression that merely means the same thing — the change log would
 * show an edit nobody made.
 */
import { Cron } from "croner";
import { formatClock } from "./clock.ts";

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MINUTES = 7 * 1440;

export type IntervalUnit = "second" | "minute" | "hour";

export type JobSchedule =
  | { kind: "manual" }
  /** `time` is minutes past midnight, wall clock in the configured zone. */
  | { kind: "daily"; time: number }
  /** `days` are 0 = Sunday … 6, sorted and distinct, never all seven. */
  | { kind: "weekly"; days: number[]; time: number }
  /** `offset` is the minute past the hour, for an hourly-or-slower interval. */
  | { kind: "interval"; every: number; unit: IntervalUnit; offset?: number }
  | { kind: "custom"; cron: string };

/**
 * The intervals the picker offers: the ones that divide their unit evenly.
 * `*\/7` minutes fires at :00, :07 … :56 and then :00 again — a 4-minute gap
 * every hour — which is not "every 7 minutes" and so is shown as custom.
 */
export const INTERVAL_STEPS: Record<IntervalUnit, readonly number[]> = {
  second: [10, 15, 20, 30],
  minute: [1, 2, 5, 10, 15, 20, 30],
  hour: [1, 2, 3, 4, 6, 8, 12],
};

const UNIT_MS: Record<IntervalUnit, number> = { second: SECOND_MS, minute: MINUTE_MS, hour: HOUR_MS };

const DAY_NAMES: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function int(field: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) return null;
  const n = Number(field);
  return n >= min && n <= max ? n : null;
}

function step(field: string, unit: IntervalUnit): number | null {
  const match = /^\*\/(\d+)$/.exec(field);
  if (!match) return null;
  const n = Number(match[1]);
  return INTERVAL_STEPS[unit].includes(n) ? n : null;
}

/** A day-of-week field → sorted distinct days, or null when it isn't a plain list. */
function parseDays(field: string): number[] | null {
  if (field === "*") return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of field.toUpperCase().split(",")) {
    const range = part.split("-");
    if (range.length > 2) return null;
    const ends = range.map((d) => (d in DAY_NAMES ? DAY_NAMES[d] : int(d, 0, 7)));
    if (ends.some((d) => d === null)) return null;
    const [from, to = from] = ends as number[];
    // 7 is Sunday too; a range ending on it (`5-7`) means Fri–Sun.
    if (to < from) return null;
    for (let d = from; d <= to; d++) days.add(d % 7);
  }
  return [...days].sort((a, b) => a - b);
}

export function parseSchedule(cron: string): JobSchedule {
  const text = cron.trim();
  if (text === "") return { kind: "manual" };
  const custom: JobSchedule = { kind: "custom", cron };
  let fields = (ALIASES[text.toLowerCase()] ?? text).split(/\s+/);

  if (fields.length === 6) {
    const seconds = step(fields[0], "second");
    if (seconds !== null && fields.slice(1).every((f) => f === "*")) {
      return { kind: "interval", every: seconds, unit: "second" };
    }
    // A leading zero seconds field is just a five-field cron said at length.
    if (int(fields[0], 0, 0) === null) return custom;
    fields = fields.slice(1);
  }
  if (fields.length !== 5) return custom;

  const [min, hour, dom, mon, dow] = fields;
  if (dom !== "*" || mon !== "*") return custom;

  if (hour === "*" && dow === "*") {
    if (min === "*") return { kind: "interval", every: 1, unit: "minute" };
    const every = step(min, "minute");
    if (every !== null) return { kind: "interval", every, unit: "minute" };
    const offset = int(min, 0, 59);
    if (offset !== null) return { kind: "interval", every: 1, unit: "hour", offset };
    return custom;
  }

  const minute = int(min, 0, 59);
  if (minute === null) return custom;

  const everyHours = step(hour, "hour");
  if (everyHours !== null) {
    return dow === "*" ? { kind: "interval", every: everyHours, unit: "hour", offset: minute } : custom;
  }

  const h = int(hour, 0, 23);
  if (h === null) return custom;
  const days = parseDays(dow);
  if (!days || days.length === 0) return custom;
  const time = h * 60 + minute;
  return days.length === 7 ? { kind: "daily", time } : { kind: "weekly", days, time };
}

export function formatSchedule(schedule: JobSchedule): string {
  switch (schedule.kind) {
    case "manual":
      return "";
    case "daily":
      return `${schedule.time % 60} ${Math.floor(schedule.time / 60)} * * *`;
    case "weekly":
      return `${schedule.time % 60} ${Math.floor(schedule.time / 60)} * * ${schedule.days.join(",")}`;
    case "interval": {
      const { every, unit, offset = 0 } = schedule;
      if (unit === "second") return `*/${every} * * * * *`;
      if (unit === "minute") return every === 1 ? "* * * * *" : `*/${every} * * * *`;
      return every === 1 ? `${offset} * * * *` : `${offset} */${every} * * *`;
    }
    case "custom":
      return schedule.cron;
  }
}

/** Same meaning, whatever the spelling — `0 9 * * MON` and `0 9 * * 1` are one schedule. */
export function sameSchedule(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const pa = parseSchedule(a);
  const pb = parseSchedule(b);
  if (pa.kind === "custom" || pb.kind === "custom") return false;
  return formatSchedule(pa) === formatSchedule(pb);
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${n} ${word}s`;
}

export function describeDays(days: number[]): string {
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  return days.map((d) => SHORT_DAYS[d]).join(", ");
}

export function describeSchedule(schedule: JobSchedule): string {
  switch (schedule.kind) {
    case "manual":
      return "Manual only";
    case "daily":
      return `Daily at ${formatClock(schedule.time)}`;
    case "weekly":
      return `${describeDays(schedule.days)} at ${formatClock(schedule.time)}`;
    case "interval": {
      const base = `Every ${plural(schedule.every, schedule.unit)}`;
      return schedule.unit === "hour" && schedule.offset
        ? `${base} at :${String(schedule.offset).padStart(2, "0")}`
        : base;
    }
    case "custom":
      return schedule.cron;
  }
}

/** Why croner won't run this, or null when it will. `""` (manual) is fine. */
export function cronError(cron: string, timezone?: string): string | null {
  if (cron.trim() === "") return null;
  try {
    const probe = new Cron(cron, { timezone: timezone || undefined, paused: true });
    const next = probe.nextRun();
    probe.stop();
    return next ? null : "never fires";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * The shortest gap between two firings, in ms. `Infinity` for manual, and for
 * anything croner rejects — validity is `cronError`'s question, not this one's.
 */
export function minGapMs(cron: string, timezone?: string): number {
  const schedule = parseSchedule(cron);
  switch (schedule.kind) {
    case "manual":
      return Infinity;
    case "daily":
      return DAY_MS;
    case "weekly": {
      const { days } = schedule;
      if (days.length === 1) return 7 * DAY_MS;
      let gap = 7 - days[days.length - 1] + days[0];
      for (let i = 1; i < days.length; i++) gap = Math.min(gap, days[i] - days[i - 1]);
      return gap * DAY_MS;
    }
    case "interval":
      return schedule.every * UNIT_MS[schedule.unit];
    case "custom": {
      try {
        const runs = new Cron(cron, { timezone: timezone || undefined, paused: true }).nextRuns(60);
        let gap = Infinity;
        for (let i = 1; i < runs.length; i++) gap = Math.min(gap, runs[i].getTime() - runs[i - 1].getTime());
        return gap;
      } catch {
        return Infinity;
      }
    }
  }
}

/** Wall-clock weekday and minute for an instant, in `timezone`. */
export function wallClock(date: Date, timezone?: string): { day: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
    const day = DAY_NAMES[get("weekday").toUpperCase()] ?? date.getDay();
    return { day, minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  } catch {
    return { day: date.getDay(), minute: date.getHours() * 60 + date.getMinutes() };
  }
}

/**
 * Start times within a week, as minutes from Sunday 00:00 (0 … 10079).
 *
 * Daily and weekly schedules are worked out directly; a custom cron is walked
 * with croner over the week following `from`. `null` means "too frequent to
 * draw as blocks" — an interval, or a custom cron firing more than ~twice an
 * hour — and such a job belongs in the recurring strip, not on the timeline.
 */
export function weekOccurrences(cron: string, timezone?: string, from: Date = new Date()): number[] | null {
  const schedule = parseSchedule(cron);
  switch (schedule.kind) {
    case "manual":
      return [];
    case "daily":
      return [0, 1, 2, 3, 4, 5, 6].map((d) => d * 1440 + schedule.time);
    case "weekly":
      return schedule.days.map((d) => d * 1440 + schedule.time);
    case "interval":
      return null;
    case "custom": {
      try {
        const probe = new Cron(cron, { timezone: timezone || undefined, paused: true });
        const end = from.getTime() + 7 * DAY_MS;
        const out: number[] = [];
        let cursor: Date | null = from;
        for (let i = 0; i < 400; i++) {
          cursor = probe.nextRun(cursor);
          if (!cursor || cursor.getTime() >= end) break;
          const { day, minute } = wallClock(cursor, timezone);
          out.push(day * 1440 + minute);
        }
        if (out.length > 336) return null;
        return [...new Set(out)].sort((a, b) => a - b);
      } catch {
        return [];
      }
    }
  }
}

/** UTC offset of `timezone` at `instant`, in minutes. */
function offsetMinutes(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((asUtc - Math.floor(instant / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

export interface DstShift {
  /** The instant the clocks change. */
  at: number;
  /** Wall-clock minutes that are skipped (spring) or happen twice (autumn). */
  from: number;
  to: number;
  kind: "skipped" | "repeated";
}

/**
 * The clock changes in `timezone` over the year after `from`.
 *
 * A daily job at 01:30 in Europe/London does not run on the last Sunday of
 * March and has a second 01:30 in October. Neither is a bug, but a nightly
 * job that silently skips a night is the kind of thing worth a footnote.
 */
export function dstShifts(timezone: string | undefined, from: number = Date.now()): DstShift[] {
  if (!timezone) return [];
  // ~400 Intl calls, and the schedule page validates on every pointer move
  // while a block is dragged — so once per zone per day is plenty.
  const key = `${timezone}@${Math.floor(from / DAY_MS)}`;
  const cached = dstCache.get(key);
  if (cached) return cached;
  const shifts = computeDstShifts(timezone, from);
  if (dstCache.size > 20) dstCache.clear();
  dstCache.set(key, shifts);
  return shifts;
}

const dstCache = new Map<string, DstShift[]>();

function computeDstShifts(timezone: string, from: number): DstShift[] {
  const shifts: DstShift[] = [];
  try {
    let prev = offsetMinutes(from, timezone);
    for (let day = 1; day <= 366; day++) {
      const t = from + day * DAY_MS;
      const offset = offsetMinutes(t, timezone);
      if (offset === prev) continue;
      // Narrow the change down to the minute with a binary search over the day.
      let lo = t - DAY_MS;
      let hi = t;
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
        if (offsetMinutes(mid, timezone) === prev) lo = mid;
        else hi = mid;
      }
      // The wall clock read with the *old* offset at the moment of change.
      const oldClock = (((Math.floor(hi / MINUTE_MS) + prev) % 1440) + 1440) % 1440;
      const delta = offset - prev;
      shifts.push(
        delta > 0
          ? { at: hi, from: oldClock, to: oldClock + delta, kind: "skipped" }
          : { at: hi, from: oldClock + delta, to: oldClock, kind: "repeated" },
      );
      prev = offset;
    }
  } catch {
    return [];
  }
  return shifts;
}
