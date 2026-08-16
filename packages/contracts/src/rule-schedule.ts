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
export const RULE_TRIGGERS = ["item-added"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];

export const RULE_TRIGGER_LABELS: Record<RuleTrigger, string> = {
  "item-added": "Something new is added to the library",
};

/** `MM-DD`. Year-less on purpose: a season recurs, a date doesn't. */
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

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
    activeFrom: z.string().regex(MONTH_DAY, "Use MM-DD").optional(),
    activeTo: z.string().regex(MONTH_DAY, "Use MM-DD").optional(),
    triggers: z.array(z.enum(RULE_TRIGGERS)).optional(),
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
 * Is the rule inside its calendar window on this date?
 *
 * A window whose end is before its start wraps the year end, which is the case
 * that matters: `12-01` → `01-05` is Christmas, and reading it as an empty
 * range would silently disable the rule for the one month it exists for.
 *
 * A rule with no window is always active.
 */
export function isRuleActiveOn(schedule: RuleSchedule | undefined, date: Date): boolean {
  if (!schedule?.activeFrom || !schedule.activeTo) return true;
  const from = monthDayOrdinal(schedule.activeFrom);
  const to = monthDayOrdinal(schedule.activeTo);
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  // Inclusive at both ends: a window of `10-31` → `10-31` is Halloween itself,
  // and an exclusive end would make it empty.
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
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

/** "1 October – 5 November", for the rule list and the wizard's summary. */
export function describeRuleWindow(schedule: RuleSchedule | undefined): string | null {
  if (!schedule?.activeFrom || !schedule.activeTo) return null;
  const say = (value: string) => {
    const [month, day] = value.split("-").map(Number) as [number, number];
    return `${day} ${MONTHS[month - 1]}`;
  };
  return `${say(schedule.activeFrom)} – ${say(schedule.activeTo)}`;
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
