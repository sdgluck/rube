/**
 * The half of scheduling that belongs to rules rather than jobs.
 *
 * `schedule.ts` gives each *job* a cron. This gives a rule one, so a smart
 * filter over 20,000 items can run monthly while an Overseerr-requests rule
 * runs hourly, without either being pinned to the nightly batch's cadence.
 *
 * Polled once a minute rather than held as a live `Cron` per rule, which is
 * deliberate: rules are created, edited, enabled and deleted from the API
 * process, and the scheduler runs wherever the job runner does. Keeping a
 * registry of croner instances in sync across that boundary means an
 * invalidation channel and a class of bug where a deleted rule keeps firing.
 * Reading the rules table every minute has neither, and a minute is finer
 * granularity than any cron a person writes for a media server.
 */

import { Cron } from "croner";
import { createLogger, errorMessage, type JobContext } from "@tinkerbell/core";
import { getEnabledRules, setRuleLastScheduled, type Rule } from "@tinkerbell/domain.rules";
import { isRuleActiveOn, ruleConfigSchema, type RuleSchedule } from "@tinkerbell/contracts";
import { schedulerTimezone } from "./schedule.ts";

const log = createLogger("rule-schedules");

export interface DueRule {
  rule: Rule;
  /** The occurrence that came due, which is what gets recorded as satisfied. */
  occurrence: number;
}

/**
 * Read a rule's schedule without trusting it.
 *
 * A config row can predate the schema, or have been written by a newer build,
 * so this returns undefined rather than throwing on anything it can't parse —
 * a rule with an unreadable schedule falls back to the nightly batch, which is
 * where it would have run before schedules existed.
 */
export function scheduleOf(rule: Rule): RuleSchedule | undefined {
  const parsed = ruleConfigSchema.safeParse(rule.config);
  return parsed.success ? parsed.data.schedule : undefined;
}

/**
 * How many occurrences to walk forward before giving up on catching up.
 *
 * A container that was off for a week owes an hourly rule 168 runs. Running
 * them is pointless — each one would overwrite the last — so past this many
 * the scheduler skips to the present and runs once. The cap also bounds the
 * loop against a cron that somehow yields occurrences faster than it should.
 */
const MAX_CATCHUP_STEPS = 500;

/**
 * Has this rule's cron come due since it last fired, and at which occurrence?
 *
 * Walks forward from `lastScheduledAt` to the most recent occurrence at or
 * before `now`, rather than computing a next-run and sleeping to it. That
 * makes a missed tick self-correcting — a container down from 02:00 to 04:00
 * comes back, sees 03:00 passed unrecorded, and runs once. Not twice, not
 * never, and not once per missed hour.
 *
 * Exported for tests: the two failure modes (never firing, and firing every
 * minute forever) are both invisible until they have been in production a
 * while.
 */
export function isDue(
  schedule: RuleSchedule | undefined,
  lastScheduledAt: number | null,
  now: Date,
  timezone: string | undefined,
): number | null {
  if (!schedule?.cron) return null;
  // A rule out of season doesn't run on its own cron either — otherwise the
  // window would only be honoured by the batch, and a seasonal rule with a
  // cron of its own would quietly ignore its own season.
  if (!isRuleActiveOn(schedule, now)) return null;
  // Never looked at before: `adoptNewSchedules` stamps a starting point, and
  // firing here instead would run every rule the moment it was saved.
  if (lastScheduledAt == null) return null;

  let cron: Cron;
  try {
    cron = new Cron(schedule.cron, { timezone });
  } catch (err) {
    // An unparseable expression is a saved-rule problem, not a scheduler
    // problem. Say so and leave the rule to the nightly batch.
    log.warn("ignoring an invalid rule cron", { cron: schedule.cron, err: errorMessage(err) });
    return null;
  }

  let occurrence: number | null = null;
  let cursor = new Date(lastScheduledAt);
  for (let step = 0; step < MAX_CATCHUP_STEPS; step++) {
    const next = cron.nextRun(cursor);
    if (!next || next.getTime() > now.getTime()) break;
    occurrence = next.getTime();
    cursor = next;
  }
  // Hit the cap with occurrences still owed: too far behind to replay, so
  // treat now as the occurrence and run exactly once.
  if (occurrence != null && cursor.getTime() < now.getTime()) {
    const more = cron.nextRun(cursor);
    if (more && more.getTime() <= now.getTime()) occurrence = now.getTime();
  }
  return occurrence;
}

/** Every enabled rule whose own cron has come due. */
export function findDueRules(now: Date = new Date()): DueRule[] {
  const timezone = schedulerTimezone();
  const due: DueRule[] = [];
  for (const rule of getEnabledRules()) {
    const occurrence = isDue(scheduleOf(rule), rule.lastScheduledAt, now, timezone);
    if (occurrence != null) due.push({ rule, occurrence });
  }
  return due;
}

/**
 * Adopt the current occurrence for any scheduled rule that has never fired.
 *
 * Called on the same tick as the sweep so a newly-saved schedule starts
 * counting from now. Without it `isDue` would never return anything, because
 * it refuses to fire on a null `lastScheduledAt`.
 */
export function adoptNewSchedules(now: Date = new Date()): number {
  const timezone = schedulerTimezone();
  let adopted = 0;
  for (const rule of getEnabledRules()) {
    if (rule.lastScheduledAt != null) continue;
    const schedule = scheduleOf(rule);
    if (!schedule?.cron) continue;
    try {
      // Validate the expression before stamping anything, so a typo doesn't
      // silently look like an adopted schedule that never fires.
      new Cron(schedule.cron, { timezone });
      // Stamped at `now`, which means the first fire is the next occurrence
      // after the rule was saved rather than an immediate catch-up run.
      setRuleLastScheduled(rule.id, now.getTime());
      adopted++;
    } catch {
      // Invalid expression — already reported by `isDue`, nothing to adopt.
    }
  }
  return adopted;
}

/**
 * One tick of the per-rule scheduler.
 *
 * Runs due rules one at a time rather than concurrently: they go through the
 * same single-rule path the Rules page uses, which takes the rule lock, and a
 * burst of ten rules all pointed at one Plex server is the thing the shared
 * commit queue exists to prevent.
 */
export async function runDueRules(ctx: JobContext): Promise<string> {
  const adopted = adoptNewSchedules();
  const due = findDueRules();
  if (due.length === 0) {
    // Stable text: this is a quiet job, and the event is only emitted when the
    // message changes from the previous run.
    return adopted > 0 ? `Adopted ${adopted} new rule schedule(s).` : "No rule schedules due.";
  }

  const { runSingleRule } = await import("./commands/generate/index.ts");
  const { startRuleRun } = await import("@tinkerbell/domain.rule-runs");
  const { setRuleLastRun } = await import("@tinkerbell/domain.rules");

  const ran: string[] = [];
  const failed: string[] = [];
  for (const { rule, occurrence } of due) {
    ctx.signal?.throwIfAborted();
    // Recorded before the run, not after: a rule that fails must not re-fire
    // every minute until it succeeds, and the next occurrence is the right
    // time to try again.
    setRuleLastScheduled(rule.id, occurrence);

    const ruleRun = startRuleRun({
      ruleId: rule.id,
      phase: "run",
      trigger: "job",
      signal: ctx.signal,
      tee: (line) => ctx.log(line),
    });
    const startedAt = Date.now();
    try {
      const result = await runSingleRule(rule.id, ruleRun.ctx.signal, ruleRun.ctx, ruleRun.runId);
      setRuleLastRun(rule.id, {
        status: "ok",
        durationMs: Date.now() - startedAt,
        collectionCount: result.collectionCount,
        itemCount: result.itemCount,
      });
      ruleRun.finish({ status: "ok", collectionCount: result.collectionCount, itemCount: result.itemCount });
      ran.push(rule.name);

      // Anything chained behind it. A rule on an hourly cron that feeds a
      // curated shelf is the case this exists for: without it the pool is
      // refreshed every hour and the shelf built from it waits until midnight.
      // Imported lazily to keep the cycle between these two modules at run
      // time — rule-triggers imports `scheduleOf` from here.
      const { runRulesChainedAfter } = await import("./rule-triggers.ts");
      const chained = await runRulesChainedAfter(ctx, rule.id);
      if (chained) ctx.log(chained);
    } catch (err) {
      const message = errorMessage(err);
      setRuleLastRun(rule.id, { status: "error", durationMs: Date.now() - startedAt, error: message });
      ruleRun.finish({ status: "error", error: message });
      failed.push(rule.name);
      log.error("a scheduled rule failed", { rule: rule.name, err: message });
    }
  }

  const parts = [];
  if (ran.length) parts.push(`ran ${ran.length} scheduled rule(s): ${ran.join(", ")}`);
  if (failed.length) parts.push(`${failed.length} failed: ${failed.join(", ")}`);
  return parts.join("; ") || "No rule schedules due.";
}
