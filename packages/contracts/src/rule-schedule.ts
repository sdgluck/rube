/**
 * When a rule runs, as a property of the rule rather than of the job.
 *
 * Every rule used to run inside one nightly `generate`. That is the right
 * default and the wrong only option: a smart filter over a 20,000-item library
 * is expensive and monthly would do, an Overseerr-requests rule is cheap and
 * wants to be hourly, and a Halloween collection should not exist in March.
 *
 * Three independent things live here, and a rule may use any combination:
 *
 * - `cron` — run this rule on its own cadence, instead of waiting for the
 *   nightly batch.
 * - `activeFrom`/`activeTo` — a calendar window the rule is allowed to exist
 *   in. Outside it the rule is skipped *and its collections are removed*,
 *   which is the half that makes seasonal rules worth having.
 * - `triggers` — run when something happens rather than when a clock says so.
 *
 * All three are optional and absent means the behaviour every existing rule
 * already has: run in the nightly batch, all year round.
 */

import { z } from "zod";

/** Events that can start a rule. */
export const RULE_TRIGGERS = ["item-added", "item-watched", "item-removed", "request-fulfilled"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];

export const RULE_TRIGGER_LABELS: Record<RuleTrigger, string> = {
  "item-added": "Something new is added to the library",
  "item-watched": "Somebody finishes watching something",
  "item-removed": "Something disappears from the library",
  "request-fulfilled": "An Overseerr request becomes available",
};

/**
 * The honest small print for each trigger, as the checkbox's tooltip.
 *
 * Every one of these rides on a job that was already asking the question, so
 * every one inherits that job's cadence and its idea of what happened. Saying
 * so on the checkbox is cheaper than the support thread about why a rule
 * didn't fire "instantly".
 */
export const RULE_TRIGGER_NOTES: Record<RuleTrigger, string> = {
  "item-added": "After the recently-added sync sees new files. A bulk import is one trigger.",
  "item-watched": "When the playback poller closes a session past the completion threshold.",
  "item-removed": "After a media sync finds items no longer on the server.",
  "request-fulfilled": "When Overseerr reports a request as available. Needs Overseerr configured.",
};

/**
 * How soon after the event a trigger can fire, as a badge beside it.
 *
 * The latency is the period of the source job's shipped schedule
 * (`DEFAULT_JOBS` in `@rube/jobs`), which is the number someone
 * expecting "instantly" needs. Approximate on purpose: a user can move those
 * schedules, and the badge is a scale rather than a promise.
 */
export const RULE_TRIGGER_CADENCE: Record<RuleTrigger, string> = {
  "item-added": "~every 15 min",
  "item-watched": "~within a minute",
  "item-removed": "nightly",
  "request-fulfilled": "~every 15 min",
};

/**
 * How a run came to happen, in the words the run detail shows.
 *
 * Wider than `RULE_TRIGGERS` because a run has causes an event doesn't: a
 * person pressed Run, the nightly batch owned it, its own cron came due, or it
 * was standing behind another rule. Before the rule queue every non-manual run
 * was recorded as "job" and displayed as "Generate job", so a rule that rebuilt
 * itself at 14:20 on an hourly cron claimed the nightly batch had done it.
 */
export const RULE_RUN_TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  job: "Generate job",
  cron: "Its own schedule",
  chain: "After another rule",
  "item-added": "Something was added",
  "item-watched": "Somebody finished watching",
  "item-removed": "Something was removed",
  "request-fulfilled": "An Overseerr request landed",
};

/** `MM-DD`. Year-less on purpose: a season recurs, a date doesn't. */
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** One end of a yearly window. Season collections use the same spelling as a rule's window. */
export const monthDaySchema = z.string().regex(MONTH_DAY, "Use MM-DD");

export const ruleScheduleSchema = z
  .object({
    /**
     * A cron expression in the server's configured timezone. When set, this
     * rule runs on its own schedule *as well as* in the nightly batch unless
     * `excludeFromBatch` is also set — the two are separate questions, and
     * silently removing a rule from the batch because someone tried an hourly
     * cron would be a surprising way to lose a nightly run.
     */
    cron: z.string().trim().min(1).optional(),
    /** Skip this rule in the nightly `generate` batch. Only meaningful with `cron`. */
    excludeFromBatch: z.boolean().optional(),
    activeFrom: monthDaySchema.optional(),
    activeTo: monthDaySchema.optional(),
    triggers: z.array(z.enum(RULE_TRIGGERS)).optional(),
    /**
     * Rule ids this rule runs after, whenever one of them runs outside the
     * nightly batch.
     *
     * The pattern it exists for is two-stage curation: one rule builds a pool
     * (every Nolan film), a second one curates it (the three with the highest
     * IMDb rating). Inside the nightly batch `position` already orders them;
     * this is what makes the pair work when the first is on an hourly cron or
     * an event trigger and the second would otherwise sit stale until
     * midnight.
     *
     * Cycles are possible to express and are broken at run time rather than
     * rejected here: a rule can be edited into a cycle from either end, so the
     * only place with enough information is the runner.
     */
    afterRules: z.array(z.string()).optional(),
  })
  .refine((s) => (s.activeFrom == null) === (s.activeTo == null), {
    message: "A date window needs both a start and an end.",
  })
  .refine((s) => !s.excludeFromBatch || s.cron != null, {
    message: "A rule kept out of the nightly batch needs a schedule of its own, or it would never run.",
  });

export type RuleSchedule = z.infer<typeof ruleScheduleSchema>;

/** Day-of-year ordinal for a `MM-DD`, ignoring leap years. */
function monthDayOrdinal(value: string): number {
  const [month, day] = value.split("-").map(Number) as [number, number];
  return month * 100 + day;
}

/**
 * Which `MM-DD` it is where the server is configured to live.
 *
 * `contracts` holds no dependency on the config store, so the zone arrives as an
 * argument; the jobs that evaluate a schedule pass `configuredTimezone()`. An
 * unset or unknown zone falls back to the process clock, as everything else
 * touching timezones does.
 */
function todayOrdinal(date: Date, timezone?: string): number {
  const local = () => (date.getMonth() + 1) * 100 + date.getDate();
  if (!timezone) return local();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const month = value("month");
    const day = value("day");
    return month && day ? month * 100 + day : local();
  } catch {
    return local();
  }
}

/**
 * Is `date` inside the yearly window `from` → `to`?
 *
 * A window whose end is before its start wraps the year end, which is the case
 * that matters: `12-01` → `01-05` is Christmas, and reading it as an empty
 * range would silently disable it for the one month it exists for.
 *
 * Evaluated in `timezone` for the same reason a cron is: a one-day window
 * like `10-31` → `10-31` read off a UTC container is Halloween somewhere else,
 * and the window turns itself on and off eight hours from when it should.
 */
export function isMonthDayWindowActive(from: string, to: string, date: Date, timezone?: string): boolean {
  const start = monthDayOrdinal(from);
  const end = monthDayOrdinal(to);
  const today = todayOrdinal(date, timezone);
  // Inclusive at both ends: a window of `10-31` → `10-31` is Halloween itself,
  // and an exclusive end would make it empty.
  return start <= end ? today >= start && today <= end : today >= start || today <= end;
}

/** Is the rule inside its calendar window on this date? A rule with no window is always active. */
export function isRuleActiveOn(schedule: RuleSchedule | undefined, date: Date, timezone?: string): boolean {
  if (!schedule?.activeFrom || !schedule.activeTo) return true;
  return isMonthDayWindowActive(schedule.activeFrom, schedule.activeTo, date, timezone);
}

const MONTHS = [
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

/** "1 October – 5 November". */
export function describeMonthDayWindow(from: string, to: string): string {
  const say = (value: string) => {
    const [month, day] = value.split("-").map(Number) as [number, number];
    return `${day} ${MONTHS[month - 1]}`;
  };
  return `${say(from)} – ${say(to)}`;
}

/** The rule's window for the rule list and the wizard's summary. */
export function describeRuleWindow(schedule: RuleSchedule | undefined): string | null {
  if (!schedule?.activeFrom || !schedule.activeTo) return null;
  return describeMonthDayWindow(schedule.activeFrom, schedule.activeTo);
}

/**
 * Does the nightly batch own this rule?
 *
 * The default is yes, and stays yes even when a rule has a cron of its own —
 * see `excludeFromBatch`. A rule with only triggers still runs nightly too:
 * "also run when something is added" is the common intent, and "only ever run
 * on this event" is a way to have a rule quietly never run on a server where
 * the trigger's source job is disabled.
 */
export function runsInNightlyBatch(schedule: RuleSchedule | undefined): boolean {
  return !schedule?.excludeFromBatch;
}
