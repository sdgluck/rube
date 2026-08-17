import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "@tinkerbell/core";
import { plexHealthCallback } from "@tinkerbell/core";
import {
  getEnabledRules,
  getRule,
  type Rule,
  setRuleArrCounts,
  setRuleLastCollection,
  setRuleLastRun,
  setRuleWindowCleared,
  withRuleLock,
  RuleLockedError,
} from "@tinkerbell/domain.rules";
import { forgetCollections, getCollectionTitlesForRule } from "@tinkerbell/domain.collections";
import { startRuleRun } from "@tinkerbell/domain.rule-runs";
import { errorMessage } from "@tinkerbell/core";
import { createLogger, noopCheckpoint, type JobContext, type GenerateJobConfig } from "@tinkerbell/core";

import {
  describeRuleWindow,
  isCleanupRule,
  isMetadataRule,
  isRuleActiveOn,
  runsInNightlyBatch,
  type RuleSchedule,
} from "@tinkerbell/contracts";
import { parseRuleConfig } from "./config.ts";
import { announceEmptyRule, announceNewCollections } from "./events.ts";
import { diagnoseEmptyRun } from "./diagnose.ts";
import { runHandler } from "./dispatch.ts";
import { createCleanupBudget } from "./cleanup.ts";
import { createMetadataBudget } from "./metadata.ts";
import { resolveArrAdds } from "./arr.ts";
import { llmUnavailableReason } from "./ai/llm.ts";
import { withItemCache } from "./item-cache.ts";
import { bufferLog } from "./log-buffer.ts";
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
 * What one batch job owns.
 *
 * Collection rules and cleanup rules run as separate jobs — separate rows,
 * schedules and run histories — because they are separate things to a user:
 * one builds shelves, the other removes files. They share this engine because
 * a rule is (selection) → (action) and only the action differs; duplicating
 * resume, concurrency and per-rule failure handling to express that would be
 * two copies of the hard part and one copy of the easy one.
 */
interface BatchOptions {
  /** Which rules this job is responsible for. */
  owns: (rule: Rule) => boolean;
  /** Plural noun for the log lines, e.g. "cleanup rule(s)". */
  noun: string;
  /**
   * The one-time sweep of pre-`Rule:` "Generated" collections. Belongs to the
   * collection job alone — it is about collections this app used to make, and
   * running it from both would double the Plex calls to no purpose.
   */
  sweepLegacyLabels?: boolean;
}

/**
 * Batch entry point: run every enabled rule this job owns against the
 * configured Plex server. Sections per rule = rule-level filter ∩ job-level
 * filter ∩ globally-configured libraries.
 */
export async function runBatch(ctx: JobContext, config: GenerateJobConfig, opts: BatchOptions): Promise<void> {
  const { client, machineId, allSections } = await connectPlex(ctx);
  const jobSectionsOrNull = filterSections(allSections, config.sections);
  if (jobSectionsOrNull === null) {
    throw new Error(`No matching sections found for "${(config.sections ?? []).join(", ")}".`);
  }
  const jobSections = jobSectionsOrNull ?? allSections;

  const enabledRules = getEnabledRules().filter((r) => opts.owns(r));
  if (enabledRules.length === 0) {
    ctx.log(`No enabled ${opts.noun} found. Configure rules in the admin UI.`);
    return;
  }

  ctx.log(`Found ${enabledRules.length} enabled ${opts.noun}.`);

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
  if (opts.sweepLegacyLabels) {
    for (const section of jobSections) {
      const deleted = await client.deleteCollectionsByLabel(section.key, "Generated");
      forgetCollections(deleted);
      if (deleted.length > 0) {
        ctx.log(`Migrated: deleted ${deleted.length} old "Generated"-labeled collection(s) from "${section.title}".`);
      }
    }
  }

  // A rule that blows up shouldn't cost the rest of the batch — one bad
  // rule out of 34 used to abandon every rule after it. Failures are
  // recorded per rule and summarised at the end instead.
  const failures: { name: string; error: string }[] = [];
  // Rules another run was already generating when we reached them.
  const skipped: string[] = [];
  // Rules stopped individually from the UI while the batch was running.
  const cancelledRules: string[] = [];

  const concurrency = Math.min(config.ruleConcurrency ?? RULE_CONCURRENCY_DEFAULT, enabledRules.length);
  if (concurrency > 1) ctx.log(`Running up to ${concurrency} rules at a time.`);

  // The destructive-action ceiling, shared by every cleanup rule in this run
  // and by anything else acting today — it counts from the candidate ledger,
  // not from this process. Created once per run so a long run reads a stable
  // starting figure.
  const cleanupBudget = createCleanupBudget();
  // The metadata write ceiling, counted the same way and for the same reason.
  const metadataBudget = createMetadataBudget();

  /** Everything one rule does, start to finish. Never throws except on abort. */
  const runOneRule = async (rule: (typeof enabledRules)[number], jobCtx: JobContext): Promise<void> => {
    /**
     * Each rule in a batch gets its own `rule_runs` row, so a nightly job's
     * outcome is answerable per rule rather than only as one blob of job log —
     * and so the rules table can say "running" for a rule the *job* is
     * running, not just one started from the UI.
     *
     * `tee` mirrors every line into the job's own log, which keeps the job
     * transcript exactly as complete as it was before. The handle's signal
     * derives from the job's, so cancelling the job still cancels the rule,
     * and cancelling this rule's row unwinds just this rule.
     */
    const ruleRun = startRuleRun({
      ruleId: rule.id,
      phase: "run",
      trigger: "job",
      jobRunId: jobCtx.runId ?? null,
      signal: ctx.signal,
      tee: (line) => jobCtx.log(line),
    });
    const ruleCtx = ruleRun.ctx;

    const ruleConfig = parseRuleConfig(rule);
    ruleCtx.log(`\n--- Rule: "${rule.name}" (${rule.type}) ---`);

    // Out of season, or owned by its own cron rather than this batch. Both are
    // "not this rule's turn", and both have to be decided before the rule's
    // collections are deleted — the delete is the first thing a run does.
    const skip = batchSkipReason(rule, ruleConfig, new Date());
    if (skip) {
      ruleCtx.log(`Skipping — ${skip.reason}.`);
      // Only rules that build collections have anything to tear down. A
      // metadata rule's writes are not undone by going out of season — that
      // would be a startling thing for a calendar window to do — so the
      // teardown would be a Plex round trip per section that finds nothing,
      // announced with a line claiming it removed something.
      if (skip.tearDown && !isMetadataRule(ruleConfig)) {
        try {
          await clearOutOfSeasonCollections(ruleCtx, rule, ctx.signal);
          ruleCtx.log("Removed this rule's collections until it is back in season.");
        } catch (err) {
          ruleCtx.log("Failed to remove out-of-season collections:", err);
        }
      }
      ruleRun.finish({ status: "ok" });
      completedRuleIds.add(rule.id);
      saveCheckpoint();
      return;
    }
    // Back in season — forget the teardown so leaving the window next year
    // tears down again rather than assuming it was already handled.
    if (rule.windowClearedAt != null) setRuleWindowCleared(rule.id, null);

    // AI rules need a working provider. Without one every such rule fails
    // identically, so check once up front and skip rather than delete the
    // rule's existing collections and replace them with nothing.
    if (rule.type === "ai_prompt") {
      const unavailable = llmUnavailableReason();
      if (unavailable) {
        ruleCtx.log(`Skipping AI rule — ${unavailable}.`);
        ruleRun.finish({ status: "ok" });
        completedRuleIds.add(rule.id);
        saveCheckpoint();
        return;
      }
    }

    // Rule-level section override beats job-level.
    const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
    if (ruleSectionsOrNull === null) {
      ruleCtx.log(`No matching sections for rule config, skipping.`);
      ruleRun.finish({ status: "ok" });
      // A rule with nothing to do is done — don't re-evaluate it on a resume.
      completedRuleIds.add(rule.id);
      saveCheckpoint();
      return;
    }
    const sections = ruleSectionsOrNull ?? jobSections;
    ruleCtx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

    const labels = ["Tinkerbell", `Rule:${rule.id}`];
    const ruleStartedAt = Date.now();
    // Read before the run deletes them: every run recreates this rule's
    // collections from scratch, so "what's new" is only answerable against
    // the names that were there when we started.
    const collectionsBefore = getCollectionTitlesForRule(rule.id);
    // Likewise the previous item count — `setRuleLastRun` below overwrites it.
    const previousItemCount = rule.lastRunItemCount;
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

          return runHandler(
            { ctx: ruleCtx, client, sections, rule, ruleConfig, ruleRunId: ruleRun.runId },
            machineId,
            labels,
            cleanupBudget,
            metadataBudget,
          );
        },
        { signal: ruleCtx.signal },
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
      ruleRun.finish({ status: "ok", collectionCount, itemCount });

      announceNewCollections(rule.id, rule.name, collectionsBefore, getCollectionTitlesForRule(rule.id));
      // Not for cleanup rules: matching nothing is their healthy steady state,
      // and "your cleanup rule has stopped finding anything to delete" is the
      // opposite of a warning.
      if (!isCleanupRule(ruleConfig)) {
        announceEmptyRule(rule.id, rule.name, previousItemCount, itemCount, ruleRun.runId);
        // The explanation the notification can't carry. Measured now, while
        // the library still looks the way it did when the run produced zero.
        await diagnoseEmptyRun({
          ctx: ruleCtx,
          client,
          sections,
          ruleType: rule.type,
          ruleConfig,
          ruleRunId: ruleRun.runId,
          itemCount,
        });
      }

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
        // Recorded as cancelled rather than failed: nothing went wrong, this
        // slice simply yielded to the run that already held the rule.
        ruleRun.finish({ status: "cancelled" });
        skipped.push(rule.name);
        return;
      }

      const message = errorMessage(err);
      /**
       * Cancelled, or merely interrupted?
       *
       * A rule whose own row was cancelled is cancelled. So is one that
       * unwound cleanly when the job was cancelled — that's an AbortError and
       * nothing else went wrong. But a rule that failed on its own merits
       * while the job happened to be stopping still failed, and recording that
       * as "cancelled" would bury the only account of the real problem.
       */
      const abortError = err instanceof Error && err.name === "AbortError";
      const cancelled = ruleRun.cancelRequested() || (ctx.signal.aborted && abortError);
      setRuleLastRun(rule.id, {
        status: cancelled ? "cancelled" : "error",
        durationMs: Date.now() - ruleStartedAt,
        error: cancelled ? undefined : message,
      });
      ruleRun.finish(cancelled ? { status: "cancelled" } : { status: "error", error: message });

      if (ctx.signal.aborted) throw err;

      // Cancelled from its own row: the user stopped this one rule, and the
      // rest of the batch carries on. Not a failure, so not in the summary.
      if (cancelled) {
        ruleCtx.log(`Rule "${rule.name}" was cancelled.`);
        cancelledRules.push(rule.name);
        return;
      }

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
  if (cancelledRules.length > 0) {
    ctx.log(`\n${cancelledRules.length} rule(s) cancelled:`);
    for (const name of cancelledRules) ctx.log(`  - "${name}"`);
  }
  ctx.log("\nAll done!");
}

/**
 * The nightly collection build. Everything whose ending is "make a shelf".
 */
export default function run(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  return runBatch(ctx, config, {
    owns: (rule) => {
      const config = parseRuleConfig(rule);
      return !isCleanupRule(config) && !isMetadataRule(config);
    },
    noun: "collection rule(s)",
    sweepLegacyLabels: true,
  });
}

/**
 * The cleanup pass. Everything whose ending is "remove this".
 *
 * A separate job rather than a branch inside the one above: its runs are worth
 * reading on their own, it wants its own schedule (late, after the library has
 * synced and the collections are built), and a run that deletes files should
 * not share a history with one that builds shelves. The destructive ceiling is
 * unaffected by the split — it counts from the ledger, not per run.
 */
export function runCleanup(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  return runBatch(ctx, config, {
    owns: (rule) => isCleanupRule(parseRuleConfig(rule)),
    noun: "cleanup rule(s)",
  });
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
  ruleRunId?: string,
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
  // Same before/after read as the batch path — an ad-hoc run creating a
  // collection is no less newsworthy for having been started by hand.
  const collectionsBefore = getCollectionTitlesForRule(rule.id);
  const previousItemCount = rule.lastRunItemCount;

  const { lastCollectionKey, collectionCount, itemCount } = await withRuleLock(
    rule.id,
    `a manual run of "${rule.name}"`,
    async () => {
      await deleteOldCollections(ctx, client, sections, rule.id);

      ctx.progress(2, 4, `Generating collections for ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);
      const labels = ["Tinkerbell", `Rule:${rule.id}`];
      return runHandler(
        { ctx, client, sections, rule, ruleConfig, ruleRunId },
        machineId,
        labels,
        createCleanupBudget(),
        createMetadataBudget(),
      );
    },
    { waitMs: SINGLE_RUN_LOCK_WAIT_MS, signal },
  );
  if (lastCollectionKey) setRuleLastCollection(rule.id, lastCollectionKey);

  const arrResult = await resolveArrAdds(ctx, client, sections, rule, ruleConfig);
  if (ruleConfig.arr?.enabled) {
    setRuleArrCounts(rule.id, arrResult.added, arrResult.skipped, arrResult.failed);
  }

  announceNewCollections(rule.id, rule.name, collectionsBefore, getCollectionTitlesForRule(rule.id));
  // The caller (`rules.run`) writes this run's counts afterwards, so
  // `previousItemCount` is still the previous run's here.
  if (!isCleanupRule(ruleConfig)) {
    announceEmptyRule(rule.id, rule.name, previousItemCount, itemCount, ruleRunId);
    await diagnoseEmptyRun({ ctx, client, sections, ruleType: rule.type, ruleConfig, ruleRunId, itemCount });
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

export interface BatchSkip {
  reason: string;
  /** True when the rule owns collections that shouldn't outlive its season. */
  tearDown: boolean;
}

/**
 * Why the nightly batch should leave this rule alone tonight, if it should.
 *
 * Pure, and exported for tests: the two ways to get this wrong are silently
 * skipping a rule that should have run (which looks exactly like a broken
 * rule) and tearing down collections repeatedly every night for a rule that
 * has been out of season since March.
 */
export function batchSkipReason(
  rule: Pick<Rule, "windowClearedAt">,
  config: { schedule?: RuleSchedule },
  now: Date,
): BatchSkip | null {
  if (!isRuleActiveOn(config.schedule, now)) {
    const window = describeRuleWindow(config.schedule);
    return {
      reason: `outside this rule's season (${window})`,
      // Only the first night out of season does the teardown; after that the
      // collections are already gone and re-deleting them is a Plex round-trip
      // per section per night for nothing.
      tearDown: rule.windowClearedAt == null,
    };
  }
  if (!runsInNightlyBatch(config.schedule)) {
    return { reason: `it runs on its own schedule (${config.schedule?.cron})`, tearDown: false };
  }
  return null;
}

/**
 * Take down a rule's collections because the rule is out of season.
 *
 * The teardown is what makes a calendar window worth having: a Halloween rule
 * that merely stops running in November leaves its collections pinned to the
 * home screen until someone notices. Runs once on the way out — `windowCleared`
 * on the rule row remembers it — and is undone by re-entering the window.
 */
export async function clearOutOfSeasonCollections(
  ctx: JobContext,
  rule: Rule,
  signal?: AbortSignal,
): Promise<{ cleared: boolean }> {
  const ruleConfig = parseRuleConfig(rule);
  const { client, allSections } = await connectPlex(ctx, signal);
  const sections = filterSections(allSections, ruleConfig.sections) ?? allSections;
  await deleteOldCollections(ctx, client, sections, rule.id);
  setRuleWindowCleared(rule.id, Date.now());
  // The rule now owns nothing, and the Rules table's "last run" counts should
  // say so rather than keep advertising a set that no longer exists.
  setRuleLastRun(rule.id, { status: "ok", durationMs: 0, collectionCount: 0, itemCount: 0 });
  return { cleared: true };
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

/**
 * The metadata pass. Everything whose ending is "fix these fields".
 *
 * Its own job for the same reasons cleanup has one: it wants its own schedule
 * (after the library has synced, so the fields it reads are current), its runs
 * are worth reading on their own, and a run that overwrites hand-curated
 * metadata should not share a history with one that builds shelves. The write
 * ceiling is unaffected by the split — it counts from the ledger, not per run.
 */
export function runMetadata(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  return runBatch(ctx, config, {
    owns: (rule) => isMetadataRule(parseRuleConfig(rule)),
    noun: "metadata rule(s)",
  });
}
