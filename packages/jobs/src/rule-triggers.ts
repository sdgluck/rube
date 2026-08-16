/**
 * Rules that run because something happened, rather than because a clock said
 * so.
 *
 * Only one trigger exists — `item-added` — and it rides on the
 * `sync-recently-added` job, which is already the thing that knows what showed
 * up in the library. That has two consequences worth being honest about, and
 * both are surfaced in the UI next to the checkbox:
 *
 * - It fires no sooner than that job's cadence. This is "shortly after
 *   something is added", not "the instant Plex finishes scanning".
 * - It sees what that job sees, which is Plex's recently-added feed. An import
 *   of five hundred files at once is one trigger, not five hundred.
 *
 * A trigger never replaces the nightly batch — see `runsInNightlyBatch`. A
 * rule that only ever ran on an event would silently stop running altogether
 * on a server where the source job is disabled, which is a bad way to find out
 * your collections are three months stale.
 */

import { createLogger, errorMessage, type JobContext } from "@tinkerbell/core";
import { getEnabledRules, setRuleLastRun } from "@tinkerbell/domain.rules";
import { isRuleActiveOn, type RuleTrigger } from "@tinkerbell/contracts";
import { scheduleOf } from "./rule-schedules.ts";

const log = createLogger("rule-triggers");

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
    // A seasonal rule stays out of season however it was started.
    return isRuleActiveOn(schedule, now);
  });
  if (listening.length === 0) return null;

  const { runSingleRule } = await import("./commands/generate/index.ts");
  const { startRuleRun } = await import("@tinkerbell/domain.rule-runs");

  ctx.log(`${eventCount} new item(s) — running ${listening.length} rule(s) that listen for it.`);

  const ran: string[] = [];
  const failed: string[] = [];
  for (const rule of listening) {
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
      ran.push(rule.name);
    } catch (err) {
      const message = errorMessage(err);
      setRuleLastRun(rule.id, { status: "error", durationMs: Date.now() - startedAt, error: message });
      ruleRun.finish({ status: "error", error: message });
      failed.push(rule.name);
      log.error("a triggered rule failed", { rule: rule.name, err: message });
    }
  }

  const parts = [];
  if (ran.length) parts.push(`Ran ${ran.length} rule(s) on new items: ${ran.join(", ")}`);
  if (failed.length) parts.push(`${failed.length} failed: ${failed.join(", ")}`);
  return parts.join("; ") || null;
}
