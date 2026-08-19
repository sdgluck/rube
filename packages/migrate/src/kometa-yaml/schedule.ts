import type { PlanWarning } from "../types.ts";

/**
 * Kometa `schedule:` → Tinkerbell's per-rule schedule.
 *
 * The two systems agree more than they look like they do. Kometa's `daily`,
 * `weekly(sunday)` and `monthly(1)` are cron expressions wearing friendlier
 * clothes, and its `range(12/01-12/31)` is exactly what `activeFrom`/`activeTo`
 * were built for — including the part where a collection *stops existing*
 * outside its window.
 *
 * `never` is the interesting one. Kometa uses it to park a definition without
 * deleting it, and the honest translation isn't a schedule at all: it's a rule
 * that exists and is switched off. Getting this right matters more than it
 * seems, because a `never` definition is invisible to the title-scan importer
 * (it never built a collection) and is precisely the kind of thing a user
 * would otherwise discover was missing months later.
 */

const DAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export interface ScheduleResult {
  /** Matches `ruleScheduleSchema`; undefined when Kometa said nothing. */
  schedule?: { cron?: string; activeFrom?: string; activeTo?: string };
  /** True for `schedule: never` — create the rule, leave it off. */
  disabled?: boolean;
  warnings: PlanWarning[];
}

/** `12/01` → `12-01`, the `MM-DD` shape `ruleScheduleSchema` validates. */
function monthDay(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function mapSchedule(raw: unknown): ScheduleResult {
  const warnings: PlanWarning[] = [];
  if (raw == null) return { warnings };

  // Kometa accepts a list, meaning "on any of these".
  const entries = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return { warnings };

  if (entries.length > 1) {
    warnings.push({
      code: "schedule-multiple",
      message: `Kometa had several schedules for this collection (${entries.join(", ")}); Tinkerbell kept the first.`,
    });
  }

  const entry = entries[0]!;

  if (entry === "never") {
    return { disabled: true, warnings };
  }
  if (entry === "daily" || entry === "hourly") {
    // Hourly is a legitimate Kometa cadence but a poor default for a rule that
    // scans a library, so it's honoured and flagged rather than quietly kept.
    if (entry === "hourly") {
      return { schedule: { cron: "0 * * * *" }, warnings };
    }
    return { schedule: { cron: "0 3 * * *" }, warnings };
  }

  const call = entry.match(/^(\w+)\s*\(([^)]*)\)$/);
  if (!call) {
    warnings.push({
      code: "schedule-unrecognised",
      message: `Couldn't read Kometa's schedule \`${entry}\` — this rule runs in the nightly batch instead.`,
    });
    return { warnings };
  }

  const [, kind, arg] = call as unknown as [string, string, string];

  switch (kind) {
    case "weekly": {
      const day = DAYS[arg.trim()];
      if (day == null) {
        warnings.push({
          code: "schedule-unrecognised",
          message: `Couldn't read the day in \`${entry}\` — this rule runs in the nightly batch instead.`,
        });
        return { warnings };
      }
      return { schedule: { cron: `0 3 * * ${day}` }, warnings };
    }
    case "monthly": {
      const day = Number(arg.trim());
      if (!Number.isFinite(day) || day < 1 || day > 28) {
        // Days 29-31 don't occur every month; cron would silently skip
        // February, so refuse rather than build a schedule that misfires.
        warnings.push({
          code: "schedule-unrecognised",
          message: `Couldn't use the day-of-month in \`${entry}\` — this rule runs in the nightly batch instead.`,
        });
        return { warnings };
      }
      return { schedule: { cron: `0 3 ${day} * *` }, warnings };
    }
    case "yearly": {
      const md = monthDay(arg);
      if (!md) {
        warnings.push({
          code: "schedule-unrecognised",
          message: `Couldn't read the date in \`${entry}\` — this rule runs in the nightly batch instead.`,
        });
        return { warnings };
      }
      const [month, day] = md.split("-");
      return { schedule: { cron: `0 3 ${Number(day)} ${Number(month)} *` }, warnings };
    }
    case "range": {
      const parts = arg.split("-");
      if (parts.length !== 2) {
        warnings.push({
          code: "schedule-unrecognised",
          message: `Couldn't read the range in \`${entry}\` — this rule runs all year instead.`,
        });
        return { warnings };
      }
      const from = monthDay(parts[0]!);
      const to = monthDay(parts[1]!);
      if (!from || !to) {
        warnings.push({
          code: "schedule-unrecognised",
          message: `Couldn't read the range in \`${entry}\` — this rule runs all year instead.`,
        });
        return { warnings };
      }
      return { schedule: { activeFrom: from, activeTo: to }, warnings };
    }
    default:
      warnings.push({
        code: "schedule-unrecognised",
        message: `Tinkerbell doesn't have an equivalent for Kometa's \`${entry}\` schedule — this rule runs in the nightly batch instead.`,
      });
      return { warnings };
  }
}
