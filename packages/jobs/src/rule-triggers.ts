import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";
import { createDeferral } from "./deferral.ts";
import { createRuleQueue } from "./rule-queue.ts";
/**
 * Rules that run because something happened, rather than because a clock said
 * so.
 *
 * Every trigger rides on a job that was already asking the question — the
 * recently-added sync knows what appeared, the playback poller knows what was
 * finished, the media sync knows what vanished — rather than polling Plex a
 * second time. A second poller asking the same question is a second answer to
 * keep consistent. That has two consequences worth being honest about, and
 * both are surfaced in the UI next to the checkbox (`RULE_TRIGGER_NOTES`):
 *
 * - A trigger fires no sooner than its source job's cadence. This is "shortly
 *   after something happened", not "the instant it happened".
 * - It sees what that job sees. An import of five hundred files at once is one
 *   trigger, not five hundred.
 *
 * A trigger never replaces the nightly batch — see `runsInNightlyBatch`. A
 * rule that only ever ran on an event would silently stop running altogether
 * on a server where the source job is disabled, which is a bad way to find out
 * your collections are three months stale.
 *
 * This module only decides *which* rules an event wakes. Running them — the
 * order, the single Plex connection, the one-at-a-time ceiling, and the chains
 * that follow — belongs to `rule-queue.ts`, because a trigger host is a job
 * that polls every thirty seconds and has no business holding whole rule runs
 * open inside its own tick.
 */

import { createLogger, type JobContext } from "@tinkerbell/core";

import { isRuleActiveOn, ruleConfigSchema, type RuleTrigger } from "@tinkerbell/contracts";

const log = createLogger("rule-triggers");

export const createRuleTriggers = perDeps(function createRuleTriggers(deps: Services) {
  const { config, rules } = deps;
  const { configuredTimezone } = config;
  const { getEnabledRules } = rules;
  const { deferralForRuleWork } = createDeferral(deps);
  const { enqueueRuleWork, scheduleRuleDrain } = createRuleQueue(deps);

  /**
   * Queue every enabled rule listening for `trigger`, if anything actually
   * happened. Returns a summary line, or null when there was nothing to do — the
   * caller folds it into its own message.
   */
  async function runTriggeredRules(ctx: JobContext, trigger: RuleTrigger, eventCount: number): Promise<string | null> {
    if (eventCount <= 0) return null;

    const now = new Date();
    const listening = getEnabledRules().filter((rule) => {
      const parsed = ruleConfigSchema.safeParse(rule.config);
      const schedule = parsed.success ? parsed.data.schedule : undefined;
      if (!schedule?.triggers?.includes(trigger)) return false;
      // A seasonal rule stays out of season however it was started, and its
      // season is read where the server lives — not where the container does.
      return isRuleActiveOn(schedule, now, configuredTimezone());
    });
    if (listening.length === 0) return null;

    // Somebody is watching, or we're outside the maintenance window.
    //
    // Dropped rather than held, unlike a due cron: a trigger never replaces the
    // nightly batch (`runsInNightlyBatch`), so the rule still runs tonight, and
    // queueing events would mean deciding what a backlog of "something was added"
    // even means an hour later. `item-watched` is the case this matters most for
    // — it fires from the playback poller, which is to say at the one moment a
    // stream is provably open.
    const busy = deferralForRuleWork();
    if (busy) {
      ctx.log(`${eventCount} ${trigger} event(s) — not running ${listening.length} rule(s): ${busy.reason}.`);
      return null;
    }

    const queued: string[] = [];
    let joined = 0;
    for (const rule of listening) {
      if (enqueueRuleWork(rule.id, trigger)) queued.push(rule.name);
      else joined++;
    }
    if (queued.length > 0) scheduleRuleDrain();

    const parts = [];
    if (queued.length) parts.push(`Queued ${queued.length} rule(s) on ${trigger}: ${queued.join(", ")}`);
    // A rule woken by two events in one poll, or already running from its cron.
    // Silence here read as "the trigger didn't fire", which is the opposite of
    // what happened.
    if (joined > 0) parts.push(`${joined} already queued or running`);
    if (parts.length === 0) return null;

    log.info("trigger queued rules", { trigger, eventCount, queued: queued.length, joined });
    return parts.join("; ");
  }

  return { runTriggeredRules };
});
