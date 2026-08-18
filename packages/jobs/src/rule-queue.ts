/**
 * One door for every rule run the server decides to make.
 *
 * Rules used to be executed inline by whoever wanted them: the per-rule cron
 * ran them in its own minute-long tick, each trigger host ran them inside the
 * job that noticed the event, chains ran them recursively from there, and the
 * Rules page ran them through a promise chain of its own. Four executors, four
 * sets of guarantees, and the only thing keeping two of them off the same rule
 * at once was the `rule_locks` lease.
 *
 * The queue is not new machinery so much as one already there, used properly:
 * `rule_runs` has had a `queued` status and a separate `createRuleRun` /
 * `activateRuleRun` pair since it was written, because the Rules page needed a
 * row to exist before the work did. A queued row *is* a pending request. This
 * makes every path use the door the manual path already used.
 *
 * What that buys, in one place instead of four:
 *
 * - **Coalescing.** A rule on an hourly cron that also listens for `item-added`
 *   and sits behind another rule could be asked for three times in a minute.
 *   The lock turned *concurrent* duplicates into skips; sequential ones each did
 *   a full delete-and-recreate against Plex. Now the second ask joins the first.
 * - **One connection.** `connectPlex` memoizes the library walk per client, so
 *   twenty rules with twenty clients is twenty walks of the same few thousand
 *   items. The batch has always connected once and kept the client; a drain does
 *   the same for everything else. This is why the drain runs the whole backlog
 *   rather than one rule per turn.
 * - **Order.** `rulesRequiringOrder` was applied by the nightly batch alone.
 *   A rule that must follow another follows it here too.
 * - **A bounded burst.** One rule at a time, so ten rules coming due at 03:00
 *   is ten sequential runs rather than ten concurrent ones pointed at one Plex
 *   server.
 *
 * The nightly batch is deliberately *not* a producer here. It shares one cached
 * client across its rules and owns a checkpoint, a resume and per-rule section
 * scoping that only make sense in one process; routing it through here would
 * cost it the cache it exists to exploit. It keeps `rule_locks` for the overlap
 * that matters, which is the case the lease was written for.
 */

import { createLogger, errorMessage, noopCheckpoint, type JobContext } from "@tinkerbell/core";
import {
  createRuleRun,
  activateRuleRun,
  findActiveRuleRun,
  getQueuedRuleRuns,
  queueRuleRun,
  type RuleRunTrigger,
} from "@tinkerbell/domain.rule-runs";
import {
  getEnabledRules,
  getRule,
  rulesRequiringOrder,
  setRuleLastRun,
  RuleLockedError,
} from "@tinkerbell/domain.rules";
import { isRuleActiveOn } from "@tinkerbell/contracts";
import { configuredTimezone } from "@tinkerbell/core";

const log = createLogger("rule-queue");

/** Why a rule was asked for. Everything except the nightly batch and the UI. */
export type RuleWorkReason = Exclude<RuleRunTrigger, "manual" | "job">;

/**
 * How far a chain of `afterRules` is followed before it is cut.
 *
 * Cycles are the reason, but not the only one: a fan-out five deep is a mistake
 * even when it terminates, and it costs whoever owns the Plex server the same
 * as a cycle would until it does.
 */
const MAX_CHAIN_DEPTH = 5;

/** Depth of each queued run within its chain, so the cap survives the queue. */
const chainDepth = new Map<string, number>();

/**
 * Ask for a rule to run.
 *
 * Returns the run id, or null when the ask was folded into one already pending
 * — which is the normal outcome for a rule wanted by two paths at once, not an
 * error. Nothing executes until `drainRuleQueue` reaches it.
 */
export function enqueueRuleWork(ruleId: string, reason: RuleWorkReason, depth = 0): string | null {
  // Coalesce against anything queued *or* running. Joining a run already in
  // flight is the same answer the Rules page gives when you press Run twice:
  // the work is happening, and a second delete-and-recreate of the same
  // collections is not a better outcome for having been asked for twice.
  if (findActiveRuleRun(ruleId, "run")) return null;
  const runId = createRuleRun({ ruleId, phase: "run", trigger: reason, message: "Queued…" });
  chainDepth.set(runId, depth);
  return runId;
}

/** True when anything is waiting. Cheap enough to ask before scheduling a drain. */
export function hasQueuedRuleWork(): boolean {
  return getQueuedRuleRuns().length > 0;
}

let drainScheduled = false;

/**
 * Run the backlog soon, on the shared rule-run chain.
 *
 * One drain queued at a time: a second request while one is pending is already
 * covered, because the pending drain reads the queue when it starts rather than
 * when it was asked for. The chain is the same one manual runs use, so a drain
 * and a "Run now" cannot overlap.
 */
export function scheduleRuleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  void queueRuleRun(async () => {
    drainScheduled = false;
    try {
      await drainRuleQueue();
    } catch (err) {
      // The chain must not reject — see `queueRuleRun`. A drain that throws is
      // a bug in the drain, not a reason to skip everyone else's turn.
      log.error("rule queue drain failed", { err: errorMessage(err) });
    }
  });
}

export interface DrainOutcome {
  ran: string[];
  failed: string[];
  skipped: string[];
}

/**
 * Run everything queued, one rule at a time, under a single Plex connection.
 *
 * The connection is opened lazily and only once: a drain that finds an empty
 * queue — the common case, since the cron ticks every minute — must not cost a
 * round trip to Plex to discover it has nothing to do.
 */
export async function drainRuleQueue(ctxIn?: JobContext): Promise<DrainOutcome> {
  const { runSingleRule, connectPlex } = await import("./commands/generate/index.ts");

  const out: DrainOutcome = { ran: [], failed: [], skipped: [] };
  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => log.info(args.map(String).join(" ")),
    progress: () => {},
    signal: new AbortController().signal,
    checkpoint: noopCheckpoint,
  };

  let plex: Awaited<ReturnType<typeof connectPlex>> | undefined;

  // Bounded rather than `while (true)`: a rule chained behind itself is caught
  // by the depth cap, but a rule that re-enqueues for any reason we haven't
  // thought of should slow the server down, not wedge it.
  for (let pass = 0; pass < MAX_CHAIN_DEPTH + 1; pass++) {
    const pending = orderQueued(getQueuedRuleRuns());
    if (pending.length === 0) break;

    for (const queued of pending) {
      ctx.signal?.throwIfAborted();

      const rule = getRule(queued.ruleId);
      if (!rule) continue;

      // Claim it. Null means the row was cancelled while it waited, or another
      // drain got there first — either way it is not ours to run.
      const handle = activateRuleRun(queued.id, { signal: ctx.signal, consolePrefix: "[rule-queue]" });
      if (!handle) continue;

      const depth = chainDepth.get(queued.id) ?? 0;
      chainDepth.delete(queued.id);
      const startedAt = Date.now();
      try {
        plex ??= await connectPlex(ctx);
        const result = await runSingleRule(rule.id, handle.ctx.signal, handle.ctx, handle.runId, plex);
        setRuleLastRun(rule.id, {
          status: "ok",
          durationMs: Date.now() - startedAt,
          collectionCount: result.collectionCount,
          itemCount: result.itemCount,
        });
        handle.finish({ status: "ok", collectionCount: result.collectionCount, itemCount: result.itemCount });
        out.ran.push(rule.name);

        // Only a rule that actually succeeded starts its chain. Curating a pool
        // the upstream rule failed to build is worse than not running: it would
        // publish yesterday's shelf as though it were today's.
        enqueueChainedAfter(rule.id, depth + 1, ctx);
      } catch (err) {
        // Contention isn't failure: the rule is being generated right now by the
        // nightly batch, and that run's output is as good as this one's.
        if (err instanceof RuleLockedError) {
          ctx.log(`Skipping "${rule.name}" — ${err.heldBy || "another run"} is already generating it.`);
          handle.finish({ status: "cancelled" });
          out.skipped.push(rule.name);
          continue;
        }
        const message = errorMessage(err);
        setRuleLastRun(rule.id, { status: "error", durationMs: Date.now() - startedAt, error: message });
        handle.finish({ status: "error", error: message });
        out.failed.push(rule.name);
        log.error("a queued rule failed", { rule: rule.name, err: message });
      }
    }
  }

  return out;
}

/**
 * Queue order: dependencies first, then whatever was asked for earliest.
 *
 * `rulesRequiringOrder` ranks only the rules whose order is load-bearing —
 * everything else shares rank 0 and keeps its arrival order, so a drain of
 * unrelated rules is still first-come-first-served.
 */
function orderQueued<T extends { ruleId: string; startedAt: number }>(queued: T[]): T[] {
  const { rank } = rulesRequiringOrder();
  return [...queued].sort((a, b) => (rank.get(a.ruleId) ?? 0) - (rank.get(b.ruleId) ?? 0) || a.startedAt - b.startedAt);
}

/**
 * The enabled, in-season rules that declare themselves to run after `ruleId`.
 *
 * Exported for tests: a chain that silently resolves to nothing looks exactly
 * like a chain that works, and only shows up as a shelf built from yesterday's
 * pool.
 */
export function rulesChainedAfter(ruleId: string, now: Date = new Date()): Array<{ id: string; name: string }> {
  return getEnabledRules()
    .filter((candidate) => {
      if (candidate.id === ruleId) return false;
      const schedule = scheduleOfRule(candidate.config);
      if (!schedule.afterRules.includes(ruleId)) return false;
      // A seasonal rule stays out of season however it was started, and its
      // season is read where the server lives — not where the container does.
      return isRuleActiveOn(schedule.window, now, configuredTimezone());
    })
    .map((candidate) => ({ id: candidate.id, name: candidate.name }));
}

/** Queue whatever declares itself to run after `ruleId`. */
function enqueueChainedAfter(ruleId: string, depth: number, ctx: JobContext): void {
  if (depth > MAX_CHAIN_DEPTH) {
    ctx.log(`Chain from rule ${ruleId} is more than ${MAX_CHAIN_DEPTH} deep — stopping here.`);
    return;
  }
  for (const candidate of rulesChainedAfter(ruleId)) {
    if (enqueueRuleWork(candidate.id, "chain", depth)) {
      ctx.log(`Queued "${candidate.name}" — it runs after this rule.`);
    }
  }
}

/**
 * The two bits of a rule's schedule this module needs, read without trusting
 * the config.
 *
 * Deliberately not via `ruleConfigSchema`: a config that fails validation for
 * an unrelated reason would silently lose its ordering constraint, and a lost
 * ordering constraint produces a wrong shelf rather than an error.
 */
function scheduleOfRule(config: Record<string, unknown>): {
  afterRules: string[];
  window: { activeFrom?: string; activeTo?: string };
} {
  const schedule = config?.schedule;
  if (!schedule || typeof schedule !== "object") return { afterRules: [], window: {} };
  const record = schedule as Record<string, unknown>;
  const after = record.afterRules;
  return {
    afterRules: Array.isArray(after) ? after.filter((id): id is string => typeof id === "string") : [],
    window: {
      activeFrom: typeof record.activeFrom === "string" ? record.activeFrom : undefined,
      activeTo: typeof record.activeTo === "string" ? record.activeTo : undefined,
    },
  };
}
