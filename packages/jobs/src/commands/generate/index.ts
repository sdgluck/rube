import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "@tinkerbell/core";
import { plexHealthCallback } from "@tinkerbell/core";
import {
  getEnabledRules,
  getRule,
  setRuleArrCounts,
  setRuleLastCollection,
  setRuleLastRun,
  withRuleLock,
  RuleLockedError,
} from "@tinkerbell/domain.rules";
import { forgetCollections } from "@tinkerbell/domain.collections";
import { errorMessage } from "@tinkerbell/core";
import { createLogger, noopCheckpoint, type JobContext, type GenerateJobConfig } from "@tinkerbell/core";

import { parseRuleConfig } from "./config.ts";
import { runHandler } from "./dispatch.ts";
import { createCleanupBudget } from "./cleanup.ts";
import { resolveArrAdds } from "./arr.ts";
import { llmUnavailableReason } from "./ai/llm.ts";
import { withItemCache } from "./item-cache.ts";
import { RULE_CONCURRENCY_DEFAULT } from "@tinkerbell/contracts";

export type { TestRuleResult, TestCollectionPreview } from "./preview.ts";
export { testRule } from "./preview.ts";

const runRuleLog = createLogger("run-rule");

/**
 * How long an ad-hoc single-rule run waits for the rule's lock. Sized for a
 * just-cancelled previous run to finish unwinding — not for queueing behind
 * the nightly batch, which would leave the user staring at a spinner for
 * however long that rule takes.
 */
const SINGLE_RUN_LOCK_WAIT_MS = 15_000;

/**
 * Batch entry point: run every enabled rule against the configured Plex
 * server. Sections per rule = rule-level filter ∩ job-level filter ∩
 * globally-configured libraries.
 */
export default async function run(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  const { client, machineId, allSections } = await connectPlex(ctx);
  const jobSectionsOrNull = filterSections(allSections, config.sections);
  if (jobSectionsOrNull === null) {
    throw new Error(`No matching sections found for "${(config.sections ?? []).join(", ")}".`);
  }
  const jobSections = jobSectionsOrNull ?? allSections;

  const enabledRules = getEnabledRules();
  if (enabledRules.length === 0) {
    ctx.log("No enabled rules found. Configure rules in the admin UI.");
    return;
  }

  ctx.log(`Found ${enabledRules.length} enabled rule(s).`);

  // Resume whatever a previous run abandoned. `generate` is the longest job in
  // the system and container restarts on a home server are routine, so
  // restarting from rule zero after an hour of work is a real cost.
  //
  // The checkpoint is discarded when the rule set has changed since it was
  // written — "skip rule X" is only meaningful against the same list.
  const saved = ctx.checkpoint.read<GenerateCheckpoint>();
  const completedRuleIds = new Set<string>(
    saved && sameRuleSet(saved.ruleIds, enabledRules) ? saved.completedRuleIds : [],
  );
  if (saved && completedRuleIds.size === 0 && saved.completedRuleIds.length > 0) {
    ctx.log("Enabled rules changed since the last run — starting from the first rule.");
  }
  if (completedRuleIds.size > 0) {
    ctx.log(`Resuming: skipping ${completedRuleIds.size} rule(s) completed in the previous run.`);
  }
  const checkpointStartedAt = saved && completedRuleIds.size > 0 ? saved.startedAt : Date.now();
  const ruleIds = enabledRules.map((r) => r.id);
  const saveCheckpoint = () =>
    ctx.checkpoint.write({
      startedAt: checkpointStartedAt,
      ruleIds,
      completedRuleIds: [...completedRuleIds],
    } satisfies GenerateCheckpoint);

  // One-time migration: delete old "Generated"-labeled collections.
  for (const section of jobSections) {
    const deleted = await client.deleteCollectionsByLabel(section.key, "Generated");
    forgetCollections(deleted);
    if (deleted.length > 0) {
      ctx.log(`Migrated: deleted ${deleted.length} old "Generated"-labeled collection(s) from "${section.title}".`);
    }
  }

  // A rule that blows up shouldn't cost the rest of the batch — one bad
  // rule out of 34 used to abandon every rule after it. Failures are
  // recorded per rule and summarised at the end instead.
  const failures: { name: string; error: string }[] = [];
  // Rules another run was already generating when we reached them.
  const skipped: string[] = [];

  const concurrency = Math.min(config.ruleConcurrency ?? RULE_CONCURRENCY_DEFAULT, enabledRules.length);
  if (concurrency > 1) ctx.log(`Running up to ${concurrency} rules at a time.`);

  // One destructive-action budget for the whole run, shared by every cleanup
  // rule. Per-rule caps don't compose — five rules each under their own limit
  // of 30 can still empty a library — so the ceiling has to be global, which
  // means a single mutable object threaded through the concurrent rule loop.
  const cleanupBudget = createCleanupBudget();

  /** Everything one rule does, start to finish. Never throws except on abort. */
  const runOneRule = async (rule: (typeof enabledRules)[number], ruleCtx: JobContext): Promise<void> => {
    const ruleConfig = parseRuleConfig(rule);
    ruleCtx.log(`\n--- Rule: "${rule.name}" (${rule.type}) ---`);

    // AI rules need a working provider. Without one every such rule fails
    // identically, so check once up front and skip rather than delete the
    // rule's existing collections and replace them with nothing.
    if (rule.type === "ai_prompt") {
      const unavailable = llmUnavailableReason();
      if (unavailable) {
        ruleCtx.log(`Skipping AI rule — ${unavailable}.`);
        completedRuleIds.add(rule.id);
        saveCheckpoint();
        return;
      }
    }

    // Rule-level section override beats job-level.
    const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
    if (ruleSectionsOrNull === null) {
      ruleCtx.log(`No matching sections for rule config, skipping.`);
      // A rule with nothing to do is done — don't re-evaluate it on a resume.
      completedRuleIds.add(rule.id);
      saveCheckpoint();
      return;
    }
    const sections = ruleSectionsOrNull ?? jobSections;
    ruleCtx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

    const labels = ["Tinkerbell", `Rule:${rule.id}`];
    const ruleStartedAt = Date.now();
    try {
      // The lock spans delete + recreate. A single-rule run started from the
      // Rules page executes in the API process and cannot see anything in this
      // worker thread's memory, so without it both runs delete the rule's
      // collections, both then create, and Plex keeps both sets.
      //
      // waitMs: 0 — the batch has 30-odd other rules to get on with, and
      // whoever holds the lock is generating this one right now anyway.
      const { lastCollectionKey, collectionCount, itemCount } = await withRuleLock(
        rule.id,
        "the Generate Collections job",
        async () => {
          // Inside the try: a Plex hiccup while clearing one rule's old
          // collections is no more fatal than the rule's own handler failing.
          await deleteOldCollections(ruleCtx, client, sections, rule.id);

          return runHandler({ ctx: ruleCtx, client, sections, rule, ruleConfig }, machineId, labels, cleanupBudget);
        },
        { signal: ctx.signal },
      );
      if (lastCollectionKey) setRuleLastCollection(rule.id, lastCollectionKey);

      const arrResult = await resolveArrAdds(ruleCtx, client, sections, rule, ruleConfig);
      if (ruleConfig.arr?.enabled) {
        setRuleArrCounts(rule.id, arrResult.added, arrResult.skipped, arrResult.failed);
      }

      setRuleLastRun(rule.id, {
        status: "ok",
        durationMs: Date.now() - ruleStartedAt,
        collectionCount,
        itemCount,
      });

      // Only after the rule has fully committed — a checkpoint written any
      // earlier would let a resume skip work that never actually landed.
      completedRuleIds.add(rule.id);
      saveCheckpoint();
    } catch (err) {
      // Contention isn't failure: the rule is being generated right now by
      // someone else, and that run's output is as good as ours would be.
      // Not checkpointed as complete, so a resume picks it up again.
      if (err instanceof RuleLockedError) {
        ruleCtx.log(`Skipping "${rule.name}" — ${err.heldBy || "another run"} is already generating it.`);
        skipped.push(rule.name);
        return;
      }

      const message = errorMessage(err);
      setRuleLastRun(rule.id, {
        status: "error",
        durationMs: Date.now() - ruleStartedAt,
        error: message,
      });

      // Cancellation and budget timeouts abort `ctx.signal` — that's the whole
      // job ending, not this rule failing, so it still propagates.
      if (ctx.signal.aborted) throw err;

      failures.push({ name: rule.name, error: message });
      ruleCtx.log(`Rule "${rule.name}" failed: ${message}`);
      ruleCtx.log("Continuing with the remaining rules.");
      // Deliberately not checkpointed as complete: a resume should retry it.
    }
  };

  // Rules are independent, so the pool is a plain shared cursor over the
  // list — no locking needed, since only one worker runs between awaits.
  const pending = enabledRules.filter((r) => !completedRuleIds.has(r.id));
  let started = 0;
  let finished = 0;

  const worker = async (): Promise<void> => {
    while (started < pending.length && !ctx.signal.aborted) {
      const rule = pending[started++];
      // With rules interleaved, streaming every line straight to the job log
      // would braid them together and make the log unreadable. Each rule's
      // output is buffered and flushed as one block when it finishes.
      const buffered = concurrency > 1 ? bufferLog(ctx) : { ctx, flush: () => {} };
      try {
        await runOneRule(rule, buffered.ctx);
      } finally {
        buffered.flush();
        finished++;
        ctx.progress(finished, pending.length, `Completed ${finished}/${pending.length} rules`);
      }
    }
  };

  // `allSettled`, not `all`: a worker rejecting (only ever an abort) must not
  // leave its siblings' rejections unhandled — those surface as an
  // unhandled rejection inside the Sidequest worker thread, where nothing
  // catches them. Every worker is waited for, then the first failure wins.
  const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const aborted = outcomes.find((o) => o.status === "rejected");
  if (aborted) throw aborted.reason;

  // Clear on success, so a stale checkpoint can never silently skip a rule on
  // the next nightly run.
  ctx.checkpoint.clear();
  if (failures.length > 0) {
    ctx.log(`\n${failures.length} of ${enabledRules.length} rule(s) failed:`);
    for (const { name, error } of failures) ctx.log(`  - "${name}": ${error}`);
  }
  if (skipped.length > 0) {
    ctx.log(`\n${skipped.length} rule(s) skipped — already being generated by another run:`);
    for (const name of skipped) ctx.log(`  - "${name}"`);
  }
  ctx.log("\nAll done!");
}

/**
 * A context whose log is collected rather than emitted, so one rule's output
 * lands in the job log as a single contiguous block. Mirrors the real
 * context's stringification so buffered lines read identically to live ones.
 */
function bufferLog(ctx: JobContext): { ctx: JobContext; flush: () => void } {
  const lines: string[] = [];
  return {
    ctx: {
      ...ctx,
      log: (...args: unknown[]) =>
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")),
    },
    flush: () => {
      if (lines.length > 0) ctx.log(lines.join("\n"));
      lines.length = 0;
    },
  };
}

interface GenerateCheckpoint {
  /** When the first (possibly earlier) run of this checkpoint began. */
  startedAt: number;
  /** The enabled-rule list this checkpoint was written against. */
  ruleIds: string[];
  completedRuleIds: string[];
}

function sameRuleSet(saved: string[], current: { id: string }[]): boolean {
  if (saved.length !== current.length) return false;
  const ids = new Set(current.map((r) => r.id));
  return saved.every((id) => ids.has(id));
}

/** Single-rule entry point used by the admin UI's "Run now" action. */
export async function runSingleRule(
  ruleId: string,
  signal?: AbortSignal,
  ctxIn?: JobContext,
): Promise<{ lastCollectionKey: string | null; collectionCount: number; itemCount: number }> {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`Rule "${ruleId}" not found`);

  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => runRuleLog.info(args.map(String).join(" ")),
    progress: () => {},
    signal: signal || new AbortController().signal,
    // A single ad-hoc rule run has nothing to resume from.
    checkpoint: noopCheckpoint,
  };

  ctx.progress(0, 4, `Running rule "${rule.name}"…`);
  ctx.log(`Running rule "${rule.name}" (${rule.type})`);

  const { client, machineId, allSections } = await connectPlex(ctx, signal);
  const ruleConfig = parseRuleConfig(rule);

  const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
  if (ruleSectionsOrNull === null) throw new Error("No matching sections for rule config.");
  const sections = ruleSectionsOrNull ?? allSections;

  // Held across delete + recreate for the same reason as the batch path: the
  // nightly `generate` runs in a worker thread and shares no memory with this
  // one, and two overlapping runs of one rule leave duplicates behind in Plex.
  //
  // The wait budget covers the common case rather than queueing behind a long
  // batch — the caller usually just cancelled its own previous run of this
  // rule, and abort takes a moment to unwind.
  const { lastCollectionKey, collectionCount, itemCount } = await withRuleLock(
    rule.id,
    `a manual run of "${rule.name}"`,
    async () => {
      await deleteOldCollections(ctx, client, sections, rule.id);

      ctx.progress(2, 4, `Generating collections for ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);
      const labels = ["Tinkerbell", `Rule:${rule.id}`];
      return runHandler({ ctx, client, sections, rule, ruleConfig }, machineId, labels, createCleanupBudget());
    },
    { waitMs: SINGLE_RUN_LOCK_WAIT_MS, signal },
  );
  if (lastCollectionKey) setRuleLastCollection(rule.id, lastCollectionKey);

  const arrResult = await resolveArrAdds(ctx, client, sections, rule, ruleConfig);
  if (ruleConfig.arr?.enabled) {
    setRuleArrCounts(rule.id, arrResult.added, arrResult.skipped, arrResult.failed);
  }

  ctx.progress(4, 4, "Done");
  ctx.log(`Done — lastCollectionKey: ${lastCollectionKey}`);
  return { lastCollectionKey, collectionCount, itemCount };
}

/**
 * Open a Plex client, fetch identity + sections, and apply the global
 * library allowlist. Shared by `run` and `runSingleRule` because both
 * need the same setup before doing anything rule-specific.
 */
async function connectPlex(
  ctx: JobContext,
  signal?: AbortSignal,
): Promise<{ client: PlexClient; machineId: string; allSections: PlexSection[] }> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

  // Memoized for the lifetime of this run: the library can't change under us
  // mid-job, and every rule that walks it was previously paying for its own
  // full pass over the same few thousand items.
  const client = withItemCache(
    createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: signal ?? ctx.signal,
      onHealth: plexHealthCallback,
    }),
  );

  ctx.log(`tinkerbell generate`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  let allSections = await client.getSections();
  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  return { client, machineId: identity.machineIdentifier, allSections };
}

/**
 * Filter sections by name or key (case-insensitive). Three states:
 *   - `undefined`: no filter set (caller falls back to a broader scope)
 *   - `null`:      filter set but nothing matched (caller decides: error / skip)
 *   - `PlexSection[]`: matches
 */
function filterSections(allSections: PlexSection[], filter: string[] | undefined): PlexSection[] | null | undefined {
  if (!filter || filter.length === 0) return undefined;
  const names = filter.map((s) => s.trim().toLowerCase());
  const matched = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
  return matched.length === 0 ? null : matched;
}

async function deleteOldCollections(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  ruleId: string,
): Promise<void> {
  const ruleLabel = `Rule:${ruleId}`;
  for (const section of sections) {
    const deleted = await client.deleteCollectionsByLabel(section.key, ruleLabel);
    // Evict the cache rows in the same breath. Without this the run's own
    // output looks duplicated on the Collections page — the collections it
    // just deleted linger alongside the ones it creates next, until the
    // nightly sync notices they're gone from Plex.
    forgetCollections(deleted);
    if (deleted.length > 0) {
      ctx.log(`Deleted ${deleted.length} old collection(s) with label "${ruleLabel}" from "${section.title}".`);
    }
  }
}
