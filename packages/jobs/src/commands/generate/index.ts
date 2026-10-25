import { perDeps } from "@rube/container";
import { ServicesToken, type Services } from "@rube/composition";
import { createPreviewCommand } from "./preview.ts";
import { createEventsCommand } from "./events.ts";
import { createDiagnoseCommand } from "./diagnose.ts";
import { createDispatchCommand } from "./dispatch.ts";
import { createCleanupCommand } from "./cleanup.ts";
import { createMetadataCommand } from "./metadata.ts";
import { createArrCommand } from "./arr.ts";
import { createLlmCommand } from "./ai/llm.ts";
import { createPlexClient, type PlexClient, type PlexSection } from "@rube/plex";

import { type Rule, RuleLockedError } from "@rube/domain.rules";

import { deriveJobContext, errorMessage } from "@rube/core";
import { createLogger, type JobContext, type GenerateJobConfig } from "@rube/core";

import {
  describeRuleWindow,
  isCleanupRule,
  isMetadataRule,
  isRuleActiveOn,
  ruleCoversSection,
  runsInNightlyBatch,
  type RuleSchedule,
} from "@rube/contracts";
import { parseRuleConfig } from "./config.ts";

import { withItemCache } from "./item-cache.ts";
import { bufferLog } from "./log-buffer.ts";
import { createHubOrder } from "../../hub-order.ts";
import { RULE_CONCURRENCY_DEFAULT } from "@rube/contracts";

export type { TestRuleResult, TestCollectionPreview } from "./preview.ts";

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

/**
 * One Plex connection, shared by every rule that runs under it.
 *
 * The `client` carries a memoized library walk (see `withItemCache`), so the
 * scope of this object *is* the scope of that cache — hold it across a batch or
 * a queue drain and the twenty rules inside pay for one walk between them.
 */
export interface PlexRunContext {
  client: PlexClient;
  machineId: string;
  allSections: PlexSection[];
}

/**
 * Filter sections by name or key (case-insensitive). Three states:
 *   - `undefined`: no filter set (caller falls back to a broader scope)
 *   - `null`:      filter set but nothing matched (caller decides: error / skip)
 *   - `PlexSection[]`: matches
 */
function filterSections(allSections: PlexSection[], filter: string[] | undefined): PlexSection[] | null | undefined {
  if (!filter || filter.length === 0) return undefined;
  // `ruleCoversSection` is the shared predicate — the "why was this skipped?"
  // panel asks the same question and used to answer it differently.
  const matched = allSections.filter((s) => ruleCoversSection(filter, s));
  return matched.length === 0 ? null : matched;
}

export interface BatchSkip {
  reason: string;
  /** True when the rule owns collections that shouldn't outlive its season. */
  tearDown: boolean;
}

export const createGenerateCommand = perDeps(function createGenerateCommand(deps: Services) {
  const { clients, collections, config, ruleRuns, rules } = deps;
  const { configuredTimezone, getConfig } = config;
  const { plexHealthCallback } = clients;
  const {
    getEnabledRules,
    getRule,
    setRuleArrCounts,
    setRuleLastCollection,
    setRuleLastRun,
    setRuleWindowCleared,
    rulesRequiringOrder,
    withRuleLock,
  } = rules;
  const { forgetCollections, getCollectionTitlesForRule } = collections;
  const { startRuleRun } = ruleRuns;
  const { announceEmptyRule, announceNewCollections } = createEventsCommand(deps);
  const { diagnoseEmptyRun } = createDiagnoseCommand(deps);
  const { runHandler } = createDispatchCommand(deps);
  const { createCleanupBudget } = createCleanupCommand(deps);
  const { createMetadataBudget } = createMetadataCommand(deps);
  const { resolveArrAdds } = createArrCommand(deps);
  const { llmUnavailableReason } = createLlmCommand(deps);
  const { applyTopPins } = createHubOrder(deps);

  const runRuleLog = createLogger("run-rule");

  /**
   * Batch entry point: run every enabled rule this job owns against the
   * configured Plex server. Sections per rule = rule-level filter ∩ job-level
   * filter ∩ globally-configured libraries.
   */
  async function runBatch(ctx: JobContext, config: GenerateJobConfig, opts: BatchOptions): Promise<void> {
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
        // would be a startling thing for a calendar window to do — and a cleanup
        // rule owns no collections either, since it stopped building an "on the
        // chopping block" shelf. For both, the teardown would be a Plex round trip
        // per section that finds nothing, announced with a line claiming it
        // removed something.
        if (skip.tearDown && !isMetadataRule(ruleConfig) && !isCleanupRule(ruleConfig)) {
          try {
            await clearOutOfSeasonCollections(ruleCtx, rule, ctx.signal);
            ruleCtx.log("Removed this rule's collections until it is back in season.");
          } catch (err) {
            ruleCtx.log("Failed to remove out-of-season collections:", err);
          }
        }
        ruleRun.finish({ status: "ok", message: `Skipped — ${skip.reason}.` });
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
          ruleRun.finish({ status: "ok", message: `Skipped — ${unavailable}.` });
          completedRuleIds.add(rule.id);
          saveCheckpoint();
          return;
        }
      }

      // Rule-level section override beats job-level.
      const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
      if (ruleSectionsOrNull === null) {
        ruleCtx.log(`No matching sections for rule config, skipping.`);
        ruleRun.finish({ status: "ok", message: "Skipped — none of this rule's libraries exist on the server." });
        // A rule with nothing to do is done — don't re-evaluate it on a resume.
        completedRuleIds.add(rule.id);
        saveCheckpoint();
        return;
      }
      const sections = ruleSectionsOrNull ?? jobSections;
      ruleCtx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

      const labels = ["Rube", `Rule:${rule.id}`];
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
            // No delete-then-recreate here any more: the commit layer reconciles
            // each collection against what this rule already owns and sweeps
            // whatever it no longer produces at the end of the run. See
            // `reconcile.ts` for why that is worth the extra reads.
            const result = await runHandler(
              { ctx: ruleCtx, client, sections, rule, ruleConfig, ruleRunId: ruleRun.runId },
              machineId,
              labels,
              cleanupBudget,
              metadataBudget,
            );
            if (!ruleCtx.signal?.aborted) {
              await removeOutOfScope(ruleCtx, client, allSections, ruleSectionsOrNull, rule.id);
            }
            return result;
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

    const pending = enabledRules.filter((r) => !completedRuleIds.has(r.id));

    // Most rules are independent, so the pool is a plain shared cursor over the
    // list — no locking needed, since only one worker runs between awaits.
    //
    // Not all of them are, for two reasons that need the same treatment.
    //
    // Two rules writing the same metadata field in the same library are decided by
    // which goes second, and that is what the Rules page promises the user their
    // positions mean. Draining those through the pool made the winner whichever
    // *finished* last, which is neither the same claim nor a stable one from night
    // to night.
    //
    // A rule listing another in `afterRules` has the same problem and used to have
    // none of the fix: the batch runs both, so nothing was missing, but it ran them
    // three at a time and the rule curating a pool would read it mid-rebuild.
    //
    // So both go first, one at a time, in an order that satisfies the dependencies;
    // everything else still interleaves.
    const { ids: mustNotInterleave, rank } = rulesRequiringOrder();
    const sequential = pending
      .filter((r) => mustNotInterleave.has(r.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    const concurrent = pending.filter((r) => !mustNotInterleave.has(r.id));
    if (sequential.length > 0) {
      ctx.log(`${sequential.length} rule(s) depend on another rule's order — running those in order, one at a time.`);
    }

    let started = 0;
    let finished = 0;

    for (const rule of sequential) {
      if (ctx.signal.aborted) break;
      try {
        await runOneRule(rule, ctx);
      } finally {
        finished++;
        ctx.progress(finished, pending.length, `Completed ${finished}/${pending.length} rules`);
      }
    }

    const worker = async (): Promise<void> => {
      while (started < concurrent.length && !ctx.signal.aborted) {
        const rule = concurrent[started++];
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
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.max(1, Math.min(concurrency, concurrent.length)) }, worker),
    );
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
  function run(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
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
  function runCleanup(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
    return runBatch(ctx, config, {
      owns: (rule) => isCleanupRule(parseRuleConfig(rule)),
      noun: "cleanup rule(s)",
    });
  }

  /**
   * Single-rule entry point used by the admin UI's "Run now" action and by the
   * rule queue.
   *
   * `plex` is the shared connection when one is on offer. It matters more than it
   * looks: `connectPlex` wraps its client in `withItemCache`, which memoizes the
   * full library walk *per client*, so a caller running twenty rules with twenty
   * clients pays for twenty walks of the same few thousand items. The batch has
   * always avoided that by connecting once and keeping the client for the whole
   * run; this is how everything else gets the same deal.
   */
  async function runSingleRule(
    ruleId: string,
    signal?: AbortSignal,
    ctxIn?: JobContext,
    ruleRunId?: string,
    plex?: PlexRunContext,
  ): Promise<{ lastCollectionKey: string | null; collectionCount: number; itemCount: number }> {
    const rule = getRule(ruleId);
    if (!rule) throw new Error(`Rule "${ruleId}" not found`);

    const ctx: JobContext =
      ctxIn ??
      deriveJobContext(deps.scope, {
        log: (...args: unknown[]) => runRuleLog.info(args.map(String).join(" ")),
        signal: signal || new AbortController().signal,
      });

    ctx.progress(0, 4, `Running rule "${rule.name}"…`);
    ctx.log(`Running rule "${rule.name}" (${rule.type})`);

    const { client, machineId, allSections } = plex ?? (await connectPlex(ctx, signal));
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
        ctx.progress(2, 4, `Generating collections for ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);
        const labels = ["Rube", `Rule:${rule.id}`];
        const result = await runHandler(
          { ctx, client, sections, rule, ruleConfig, ruleRunId },
          machineId,
          labels,
          createCleanupBudget(),
          createMetadataBudget(),
        );
        if (!signal?.aborted) await removeOutOfScope(ctx, client, allSections, ruleSectionsOrNull, rule.id);
        return result;
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

    // A manual or triggered run pins outside the worker, so the hook in
    // `sidequest/job.ts` never sees it; put the top rows back here instead.
    if (!signal?.aborted) await applyTopPins(client, sections, (msg) => ctx.log(msg));

    ctx.progress(4, 4, "Done");
    ctx.log(`Done — lastCollectionKey: ${lastCollectionKey}`);
    return { lastCollectionKey, collectionCount, itemCount };
  }

  /**
   * Open a Plex client, fetch identity + sections, and apply the global
   * library allowlist. Shared by `run` and `runSingleRule` because both
   * need the same setup before doing anything rule-specific.
   */
  async function connectPlex(ctx: JobContext, signal?: AbortSignal): Promise<PlexRunContext> {
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

    ctx.log(`rube generate`);
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
   * Why the nightly batch should leave this rule alone tonight, if it should.
   *
   * Pure, and exported for tests: the two ways to get this wrong are silently
   * skipping a rule that should have run (which looks exactly like a broken
   * rule) and tearing down collections repeatedly every night for a rule that
   * has been out of season since March.
   */
  function batchSkipReason(
    rule: Pick<Rule, "windowClearedAt">,
    config: { schedule?: RuleSchedule },
    now: Date,
  ): BatchSkip | null {
    if (!isRuleActiveOn(config.schedule, now, configuredTimezone())) {
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
  async function clearOutOfSeasonCollections(
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

  /**
   * Delete what this rule left in libraries it no longer covers.
   *
   * A run only reads and sweeps its own libraries, so narrowing a rule's scope
   * stranded everything it had made in the ones dropped: an AI rule moved from
   * Films and TV to Films alone kept "Britcom Chaos Energy" and "Animated
   * Misfits and Weirdos" in TV for months, under its label, re-pinned by nobody
   * and swept by nothing — the orphan sweep only acts on deleted rules.
   *
   * Only when the rule names its libraries and they matched. A rule with no
   * list of its own takes the job's scope, which may be narrower than the
   * server; deleting outside that would take down output the rule still makes.
   */
  async function removeOutOfScope(
    ctx: JobContext,
    client: PlexClient,
    allSections: PlexSection[],
    ruleSections: PlexSection[] | null | undefined,
    ruleId: string,
  ): Promise<void> {
    if (!ruleSections) return;
    const covered = new Set(ruleSections.map((s) => s.key));
    await deleteOldCollections(
      ctx,
      client,
      allSections.filter((s) => !covered.has(s.key)),
      ruleId,
    );
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
  function runMetadata(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
    return runBatch(ctx, config, {
      owns: (rule) => isMetadataRule(parseRuleConfig(rule)),
      noun: "metadata rule(s)",
    });
  }

  return {
    // Re-exposed rather than re-exported: `testRule` is the engine's dry-run,
    // and callers reach it through the engine rather than the preview module.
    ...createPreviewCommand(deps),
    runBatch,
    run,
    runCleanup,
    runSingleRule,
    connectPlex,
    batchSkipReason,
    clearOutOfSeasonCollections,
    runMetadata,
  };
});

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createGenerateCommand>["run"]>[1],
): Promise<void> {
  return createGenerateCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
