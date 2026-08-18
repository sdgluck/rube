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
 */

import { configuredTimezone, createLogger, errorMessage, type JobContext } from "@tinkerbell/core";
import { getEnabledRules, setRuleLastRun } from "@tinkerbell/domain.rules";
import { isRuleActiveOn, type RuleTrigger } from "@tinkerbell/contracts";
import { scheduleOf } from "./rule-schedules.ts";

const log = createLogger("rule-triggers");

/**
 * How far a chain of `afterRules` is followed before it is cut.
 *
 * Cycles are the reason, but not the only one: a fan-out five deep is a
 * mistake even when it terminates, and running it costs whoever owns the Plex
 * server the same as a cycle would until it does.
 */
const MAX_CHAIN_DEPTH = 5;

interface Outcome {
  ran: string[];
  failed: string[];
}

/**
 * Run a set of rules in sequence, then anything chained behind them.
 *
 * `seen` is carried through the recursion and is the cycle guard: a rule runs
 * at most once per chain however many ways round it is reachable. It is per
 * *chain*, not global — the same rule may legitimately run again from the next
 * trigger ten minutes later.
 */
async function runRules(
  ctx: JobContext,
  rules: { id: string; name: string }[],
  seen: Set<string>,
  depth: number,
): Promise<Outcome> {
  const { runSingleRule } = await import("./commands/generate/index.ts");
  const { startRuleRun } = await import("@tinkerbell/domain.rule-runs");

  const out: Outcome = { ran: [], failed: [] };

  for (const rule of rules) {
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    ctx.signal?.throwIfAborted();

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
      out.ran.push(rule.name);

      // Only a rule that actually succeeded starts its chain. Curating a pool
      // the upstream rule failed to build is worse than not running: it would
      // publish yesterday's shelf as though it were today's.
      const next = await runChain(ctx, rule.id, seen, depth + 1);
      out.ran.push(...next.ran);
      out.failed.push(...next.failed);
    } catch (err) {
      const message = errorMessage(err);
      setRuleLastRun(rule.id, { status: "error", durationMs: Date.now() - startedAt, error: message });
      ruleRun.finish({ status: "error", error: message });
      out.failed.push(rule.name);
      log.error("a triggered rule failed", { rule: rule.name, err: message });
    }
  }

  return out;
}

/** Rules that name `ruleId` in their `afterRules`, run in turn. */
async function runChain(ctx: JobContext, ruleId: string, seen: Set<string>, depth: number): Promise<Outcome> {
  if (depth > MAX_CHAIN_DEPTH) {
    ctx.log(`Chain from rule ${ruleId} is more than ${MAX_CHAIN_DEPTH} deep — stopping here.`);
    return { ran: [], failed: [] };
  }

  const now = new Date();
  const downstream = getEnabledRules().filter((candidate) => {
    if (candidate.id === ruleId) return false;
    const schedule = scheduleOf(candidate);
    if (!schedule?.afterRules?.includes(ruleId)) return false;
    // A seasonal rule stays out of season however it was started, and its
    // season is read where the server lives — not where the container does.
    return isRuleActiveOn(schedule, now, configuredTimezone());
  });
  if (downstream.length === 0) return { ran: [], failed: [] };

  ctx.log(`Running ${downstream.length} rule(s) chained after it.`);
  return runRules(ctx, downstream, seen, depth);
}

/**
 * Run every enabled rule listening for `trigger`, if anything actually
 * happened. Returns a summary line, or null when there was nothing to do —
 * the caller folds it into its own message.
 */
export async function runTriggeredRules(
  ctx: JobContext,
  trigger: RuleTrigger,
  eventCount: number,
): Promise<string | null> {
  if (eventCount <= 0) return null;

  const now = new Date();
  const listening = getEnabledRules().filter((rule) => {
    const schedule = scheduleOf(rule);
    if (!schedule?.triggers?.includes(trigger)) return false;
    // A seasonal rule stays out of season however it was started, and its
    // season is read where the server lives — not where the container does.
    return isRuleActiveOn(schedule, now, configuredTimezone());
  });
  if (listening.length === 0) return null;

  ctx.log(`${eventCount} ${trigger} event(s) — running ${listening.length} rule(s) that listen for it.`);

  const { ran, failed } = await runRules(ctx, listening, new Set(), 0);

  const parts = [];
  if (ran.length) parts.push(`Ran ${ran.length} rule(s) on ${trigger}: ${ran.join(", ")}`);
  if (failed.length) parts.push(`${failed.length} failed: ${failed.join(", ")}`);
  return parts.join("; ") || null;
}

/**
 * Run whatever is chained behind a rule that has just finished elsewhere —
 * the per-rule cron in `rule-schedules`, for instance.
 *
 * `seen` belongs to the caller so that one scheduler tick shares a single set:
 * a rule chained behind two rules that are both due must run once, not twice.
 * It used to start a fresh set per call, which is exactly how that happened.
 */
export async function runRulesChainedAfter(
  ctx: JobContext,
  ruleId: string,
  seen: Set<string> = new Set(),
): Promise<string | null> {
  seen.add(ruleId);
  const { ran, failed } = await runChain(ctx, ruleId, seen, 1);
  const parts = [];
  if (ran.length) parts.push(`Ran ${ran.length} chained rule(s): ${ran.join(", ")}`);
  if (failed.length) parts.push(`${failed.length} failed: ${failed.join(", ")}`);
  return parts.join("; ") || null;
}
