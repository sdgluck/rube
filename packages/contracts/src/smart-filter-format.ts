import { fieldDef, fieldKind, fieldLabel } from "./smart-filter-fields.ts";
import type { SmartFilterOp } from "@rube/plex-smart-filter";
import { formatResolution, formatRuntime } from "./value-format.ts";
import { opLabel } from "./smart-filter-ops.ts";

/** Placeholder for a clause whose value hasn't been filled in yet. */
export const UNSET = "?";

// ─── Relative dates ─────────────────────────────────────────────────────────

/** Plex relative date offset: `-7d`, `-2w`, `-3mon`, `-20y`. */
const RELATIVE_DATE = /^-(\d+)(d|w|mon|y)$/;

export type RelativeUnit = "d" | "w" | "mon" | "y";

export interface RelativeDate {
  amount: number;
  unit: RelativeUnit;
}

export function parseRelativeDate(value: string): RelativeDate | null {
  const m = value.match(RELATIVE_DATE);
  return m ? { amount: Number(m[1]), unit: m[2] as RelativeUnit } : null;
}

export function toRelativeDate(amount: number, unit: RelativeUnit): string {
  return `-${amount}${unit}`;
}

const UNIT_NOUNS: Record<RelativeUnit, [singular: string, plural: string]> = {
  d: ["day", "days"],
  w: ["week", "weeks"],
  mon: ["month", "months"],
  y: ["year", "years"],
};

/** `-30d` → `30 days`. */
export function relativeSpanText({ amount, unit }: RelativeDate): string {
  const [one, many] = UNIT_NOUNS[unit];
  return `${amount} ${amount === 1 ? one : many}`;
}

/** The calendar date a relative offset resolves to today, for helper text. */
export function resolveRelativeDate({ amount, unit }: RelativeDate): Date {
  const d = new Date();
  if (unit === "d") d.setDate(d.getDate() - amount);
  else if (unit === "w") d.setDate(d.getDate() - amount * 7);
  else if (unit === "mon") d.setMonth(d.getMonth() - amount);
  else d.setFullYear(d.getFullYear() - amount);
  return d;
}

// ─── Absolute dates ─────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Plex also stores some dates as epoch seconds. */
const EPOCH_SECONDS = /^\d{9,11}$/;

export function formatDateValue(value: string): string {
  if (ISO_DATE.test(value)) {
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? value : formatCalendarDate(d);
  }
  if (EPOCH_SECONDS.test(value)) {
    return formatCalendarDate(new Date(Number(value) * 1000));
  }
  // A bare year is a legitimate Plex date filter.
  if (/^\d{4}$/.test(value)) return value;
  return value;
}

export function formatCalendarDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ─── Values ─────────────────────────────────────────────────────────────────

export function isTruthyBoolean(value: string): boolean {
  return value === "1" || value === "true";
}

/**
 * Values lifted straight out of a Plex filter URI keep their percent-encoding
 * — `Amazon%20Studios` is a real stored value. Decode for display only; the
 * saved value is left exactly as it is.
 */
function decodeForDisplay(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Render a stored filter value as English. Tag values need a per-section
 * network lookup to resolve their numeric key, so callers that have one pass
 * the resolved title in as `resolvedTag`; without it we fall back to whatever
 * we can say about the raw value.
 */
export function formatFilterValue(field: string, value: string, resolvedTag?: string): string {
  if (!value) return UNSET;
  switch (fieldKind(field)) {
    case "boolean":
      return isTruthyBoolean(value) ? "Yes" : "No";
    case "date": {
      const rel = parseRelativeDate(value);
      return rel ? `${relativeSpanText(rel)} ago` : formatDateValue(value);
    }
    case "duration": {
      const ms = Number(value);
      return Number.isFinite(ms) && ms > 0 ? formatRuntime(ms) : value;
    }
    case "rating": {
      const n = Number(value);
      return Number.isFinite(n) ? `${n}/10` : value;
    }
    case "number": {
      const unit = fieldDef(field)?.unit;
      return unit ? `${value} ${unit}` : value;
    }
    case "tag": {
      if (resolvedTag) return decodeForDisplay(resolvedTag);
      // An unresolved tag value is a numeric key we can't translate. Say
      // nothing misleading — except `resolution`, whose values are codes we
      // do know how to spell out.
      if (fieldDef(field)?.field === "resolution" && !/^\d+$/.test(value)) return formatResolution(value);
      return decodeForDisplay(value);
    }
    default:
      return decodeForDisplay(value);
  }
}

/**
 * Watch-history clauses that read as nonsense through the generic
 * label-op-value path.
 *
 * `tb.watchedByAll = 1` is a whole English sentence on its own — gluing an
 * operator into it produces "Watched by everyone is Yes", and "Abandoned below
 * is less than 20 %" is worse. Returns null for the local fields the generic
 * path already handles well (`tb.playCount is at least 3`, `tb.lastPlayedAt in
 * the last 30 days`).
 */
function describeLocalCondition(
  field: string,
  op: SmartFilterOp,
  values: string[],
  resolved?: string[],
): string | null {
  const negated = op === "!=";

  switch (field) {
    case "tb.watchedByAll": {
      const yes = isTruthyBoolean(values[0] ?? "1") !== negated;
      return yes ? "Watched by everyone" : "Not watched by everyone";
    }
    case "tb.watchedByNobody": {
      const yes = isTruthyBoolean(values[0] ?? "1") !== negated;
      return yes ? "Watched by nobody" : "Watched by someone";
    }
    case "tb.watchedBy": {
      const who = values.map((v, i) => resolved?.[i] || (v ? `user ${v}` : UNSET)).join(", ") || UNSET;
      return negated ? `Not watched by ${who}` : `Watched by ${who}`;
    }
    case "tb.abandonedPct": {
      const pct = values[0] || UNSET;
      // The field name already says "below"; the operator picks the direction.
      if (op === "<" || op === "<=") return `Abandoned below ${pct}%`;
      if (op === ">" || op === ">=") return `Watched past ${pct}%`;
      return `Highest completion ${opLabel(field, op)} ${pct}%`;
    }
    default:
      return null;
  }
}

/**
 * A whole clause as a sentence fragment: "Genre is Horror",
 * "Date added in the last 30 days".
 *
 * Relative dates get their own phrasing because gluing the operator label to
 * the value produces nonsense — "Date added is on or after 30 days ago" is
 * technically right and no one reads it that way.
 */
export function describeCondition(field: string, op: SmartFilterOp, values: string[], resolved?: string[]): string {
  const label = fieldLabel(field);

  const local = describeLocalCondition(field, op, values, resolved);
  if (local) return local;

  if (fieldKind(field) === "date" && values.length === 1) {
    const rel = parseRelativeDate(values[0]);
    if (rel) {
      const span = relativeSpanText(rel);
      if (op === ">=" || op === ">") return `${label} in the last ${span}`;
      if (op === "<=" || op === "<") return `${label} more than ${span} ago`;
    }
  }

  const text = values.map((v, i) => formatFilterValue(field, v, resolved?.[i])).join(", ") || UNSET;
  return `${label} ${opLabel(field, op)} ${text}`;
}
