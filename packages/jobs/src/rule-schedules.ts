import { perDeps } from "@rube/container";
import { type Services } from "@rube/composition";
import { createDeferral } from "./deferral.ts";
import { createRuleQueue } from "./rule-queue.ts";
import { createSchedule } from "./schedule.ts";
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
import { createLogger, errorMessage, type JobContext } from "@rube/core";
import { type Rule } from "@rube/domain.rules";
import { isRuleActiveOn, ruleConfigSchema, type RuleSchedule } from "@rube/contracts";

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
  if (!isRuleActiveOn(schedule, now, timezone)) return null;
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

export const createRuleSchedules = perDeps(function createRuleSchedules(deps: Services) {
  /** Drop every pending rule hold. For tests and shutdown. */
  function clearHeldRules(): void {
    heldRules.clear();
  }

  /**
   * Rules whose cron came due while the server was busy, and when we first held
   * them.
   *
   * Measured from the *first* occurrence held rather than the most recent one,
   * exactly as `schedule.ts` measures a deferred job start — otherwise an hourly
   * rule on a busy evening renews its own deadline every hour and never reaches
   * the ceiling at all.
   *
   * In memory for the same reason the job-side map is: a deferral is worth as
   * long as the process that owes it, and a restart should run what it is due.
   */
  const heldRules = new Map<string, { name: string; heldSince: number }>();

  const { rules } = deps;
  const { getEnabledRules, setRuleLastScheduled } = rules;
  const { deferralForRuleWork, maxDeferralMs } = createDeferral(deps);
  const { enqueueRuleWork, scheduleRuleDrain } = createRuleQueue(deps);
  const { schedulerTimezone } = createSchedule(deps);

  /** Snapshot of rules waiting for the server to go quiet, for the Jobs page. */
  function deferredRuleStarts(): Array<{
    ruleId: string;
    ruleName: string;
    waitingSince: number;
    deadline: number;
  }> {
    const ceiling = maxDeferralMs();
    return [...heldRules.entries()].map(([ruleId, entry]) => ({
      ruleId,
      ruleName: entry.name,
      waitingSince: entry.heldSince,
      deadline: entry.heldSince + ceiling,
    }));
  }

  /** Every enabled rule whose own cron has come due. */
  function findDueRules(now: Date = new Date()): DueRule[] {
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
  function adoptNewSchedules(now: Date = new Date()): number {
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
   * Decides what is due and queues it; `rule-queue.ts` decides when it runs and
   * in what order. Keeping those apart is what lets this stay a job that fires
   * every minute and finishes in milliseconds, while the work it asks for takes
   * as long as it takes.
   */
  async function runDueRules(ctx: JobContext): Promise<string> {
    const adopted = adoptNewSchedules();
    const due = findDueRules();

    // Forget holds for rules that are no longer due — disabled, deleted, or their
    // schedule edited out from under the hold. Otherwise the map is a slow leak,
    // and the Jobs page lists rules as waiting that nothing intends to run.
    const dueIds = new Set(due.map((entry) => entry.rule.id));
    for (const id of heldRules.keys()) {
      if (!dueIds.has(id)) heldRules.delete(id);
    }

    if (due.length === 0) {
      // Stable text: this is a quiet job, and the event is only emitted when the
      // message changes from the previous run.
      return adopted > 0 ? `Adopted ${adopted} new rule schedule(s).` : "No rule schedules due.";
    }

    // Asked once per tick, not once per rule: it reads the config and counts open
    // streams, and the answer cannot meaningfully change between two rules in the
    // same loop.
    const busy = deferralForRuleWork();
    const ceiling = maxDeferralMs();

    const queued: string[] = [];
    const joined: string[] = [];
    const held: string[] = [];
    for (const { rule, occurrence } of due) {
      ctx.signal?.throwIfAborted();

      // Somebody is watching, or we're outside the maintenance window. Hold the
      // rule *without* stamping `lastScheduledAt`, so `isDue` offers the same
      // occurrence again next minute and the tick retries by itself — the same
      // self-correcting property a missed tick already has.
      if (busy) {
        const existing = heldRules.get(rule.id);
        if (!existing) {
          heldRules.set(rule.id, { name: rule.name, heldSince: Date.now() });
          log.info("holding a scheduled rule back", { rule: rule.name, reason: busy.reason });
          held.push(rule.name);
          continue;
        }
        if (Date.now() - existing.heldSince < ceiling) {
          held.push(rule.name);
          continue;
        }
        // Out of patience. Said out loud rather than silently, exactly as the job
        // side says it: running anyway is right, but it is the opposite of what
        // the setting asked for, and somebody seeing this nightly has learned
        // their window is too tight.
        log.warn("running a held rule anyway — waited long enough", {
          rule: rule.name,
          reason: busy.reason,
          waitedMs: Date.now() - existing.heldSince,
        });
      }
      heldRules.delete(rule.id);

      // Recorded before the run, not after: a rule that fails must not re-fire
      // every minute until it succeeds, and the next occurrence is the right time
      // to try again. Recorded before *queueing*, for the same reason — the
      // occurrence has been acted on once the request exists.
      setRuleLastScheduled(rule.id, occurrence);

      // Queued rather than run here. This tick used to execute whole rules inside
      // a job that fires every minute: ten rules due at 03:00 at five minutes each
      // blew the job's 30-minute budget, the watchdog force-failed the tick, and
      // the rules that hadn't run yet waited for their next occurrence. The queue
      // has no such deadline, runs them one at a time under one Plex connection,
      // and folds a rule already running into the run in flight.
      if (enqueueRuleWork(rule.id, "cron")) queued.push(rule.name);
      else joined.push(rule.name);
    }

    if (queued.length > 0) scheduleRuleDrain();

    const parts = [];
    if (queued.length) parts.push(`queued ${queued.length} scheduled rule(s): ${queued.join(", ")}`);
    // Worth saying: "nothing happened" and "it was already happening" look the
    // same from the outside and have very different causes.
    if (joined.length) parts.push(`${joined.length} already queued or running`);
    // Stable text while nothing but holding is happening, so a quiet evening
    // doesn't emit an event every minute — the same reason the empty case has one
    // fixed phrasing rather than a count.
    if (held.length && parts.length === 0) {
      return `Holding ${held.length} due rule(s) — ${busy?.reason ?? "server busy"}.`;
    }
    if (held.length) parts.push(`${held.length} held`);
    return parts.join("; ") || "No rule schedules due.";
  }

  return { deferredRuleStarts, clearHeldRules, findDueRules, adoptNewSchedules, runDueRules };
});
