import { z } from "zod";
import {
  getRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  setRuleLastRun,
  setRuleLastTest,
  listDeletedRules,
  restoreDeletedRules,
} from "@tinkerbell/domain.rules";
import {
  activateRuleRun,
  createRuleRun,
  findActiveRuleRun,
  getActiveRuleRuns,
  getRuleRun,
  getRuleRunLog,
  getRuleRuns,
  getRuleRunCounts,
  getRuleRunsForJobRun,
  getRecentRuleRuns,
  queueRuleRun,
  requestRuleRunCancel,
  setLastTestResult,
  getLastTestResult,
  clearLastTestResult,
  hasLastTestResult,
  getRunChanges,
  getRunChangeCounts,
  getRememberedMembers,
  rememberMembers,
  clearRunChanges,
  type PersistedTestResult,
  type RuleRunPhase,
} from "@tinkerbell/domain.rule-runs";
import {
  forgetCollectionArtwork,
  getCollectionArtworkForRule,
  upsertCollectionByKey,
} from "@tinkerbell/domain.collections";
import { errorMessage } from "@tinkerbell/core";
import { ruleConfigSchema } from "@tinkerbell/contracts";
import { t, procedure, getPlexClient } from "./_base.ts";

/**
 * Reject a config the generate job couldn't parse, without rewriting it.
 *
 * Validation is deliberately a check rather than a transform: `ruleConfigSchema`
 * is a plain object schema, so parsing and storing its output would silently
 * drop any key it doesn't know about — including keys written by a newer
 * version of Tinkerbell that a rolled-back instance is now editing. Callers
 * keep storing exactly what they sent; they just can't store nonsense.
 */
function assertValidRuleConfig(config: Record<string, unknown>): Record<string, unknown> {
  const parsed = ruleConfigSchema.safeParse(config);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ");
    throw new Error(`Invalid rule config: ${detail}`);
  }
  return config;
}

/**
 * Start a rule run/test, or hand back the one already in flight.
 *
 * Returns as soon as the run has a row — it does not wait for the run to
 * finish. The mutation used to stay open for the whole run, which made the
 * HTTP request the only record that the run existed: a proxy timeout or a
 * closed laptop lid ended the request, the row went quiet in the UI, and the
 * work carried on invisibly on the server. The row is the record now, and the
 * client polls it.
 *
 * Pressing Run on a rule that is already running attaches to that run rather
 * than starting a second one. A rule run is delete-then-recreate, and Plex
 * happily keeps two collections with the same title.
 */
function startOrAttachRuleRun(ruleId: string, phase: RuleRunPhase): { runId: string; attached: boolean } {
  const existing = findActiveRuleRun(ruleId, phase);
  if (existing) return { runId: existing.id, attached: true };

  const runId = createRuleRun({ ruleId, phase, trigger: "manual" });
  // Queued, not raced: manual runs execute one at a time so a bulk "run all"
  // doesn't point twenty concurrent rules at one Plex server.
  void queueRuleRun(() => executeRuleRun(ruleId, phase, runId));
  return { runId, attached: false };
}

async function executeRuleRun(ruleId: string, phase: RuleRunPhase, runId: string): Promise<void> {
  const consolePrefix = phase === "run" ? "[run-rule]" : "[test-rule]";
  const handle = activateRuleRun(runId, { consolePrefix });
  // Null means the run was cancelled while it waited its turn. Nothing to do,
  // and nothing to record — `requestRuleRunCancel` already wrote the row.
  if (!handle) return;

  const startedAt = Date.now();
  try {
    if (phase === "run") {
      const { runSingleRule } = await import("@tinkerbell/jobs");
      const result = await runSingleRule(ruleId, handle.ctx.signal, handle.ctx, runId);
      setRuleLastRun(ruleId, {
        status: "ok",
        durationMs: Date.now() - startedAt,
        collectionCount: result.collectionCount,
        itemCount: result.itemCount,
      });
      handle.finish({ status: "ok", collectionCount: result.collectionCount, itemCount: result.itemCount });
      return;
    }

    const { testRule } = await import("@tinkerbell/jobs");
    const result = await testRule(ruleId, handle.ctx.signal, handle.ctx);
    const itemCount = result.collections.reduce((sum, c) => sum + c.items.length, 0);
    const durationMs = Date.now() - startedAt;
    setLastTestResult({
      ruleId,
      finishedAt: Date.now(),
      durationMs,
      status: "ok",
      collections: result.collections,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      cleanup: result.cleanup,
      metadata: result.metadata,
      funnel: result.funnel,
    });
    setRuleLastTest(ruleId, {
      status: "ok",
      durationMs,
      collectionCount: result.collections.length,
      itemCount,
    });
    handle.finish({ status: "ok", collectionCount: result.collections.length, itemCount });
  } catch (err) {
    // The row, not the exception type, decides how this is recorded: a run
    // cancelled from another tab surfaces here as a plain AbortError.
    const aborted = handle.cancelRequested() || (err instanceof Error && err.name === "AbortError");
    const status = aborted ? "cancelled" : "error";
    const message = errorMessage(err);
    if (aborted) {
      console.log(`${consolePrefix} ${phase === "run" ? "Run" : "Test"} for rule "${ruleId}" was cancelled`);
    } else {
      console.error(`${consolePrefix} ${phase === "run" ? "Run" : "Test"} for rule "${ruleId}" failed:`, message);
    }
    const outcome = { status, durationMs: Date.now() - startedAt, error: aborted ? undefined : message } as const;
    if (phase === "run") setRuleLastRun(ruleId, outcome);
    else setRuleLastTest(ruleId, outcome);
    handle.finish({ status, error: aborted ? undefined : message });
  }
}

export const rulesRouter = t.router({
  list: procedure.query(() => {
    const tallies = getRuleRunCounts();
    return getRules().map((r) => ({
      ...r,
      hasTestResult: hasLastTestResult(r.id),
      runCount: tallies[r.id]?.count ?? 0,
      lastRunId: tallies[r.id]?.lastRunId ?? null,
    }));
  }),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const rule = getRule(input.id);
    if (!rule) throw new Error(`Rule ${input.id} not found`);
    return rule;
  }),

  create: procedure
    .input(z.object({ name: z.string(), type: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => {
      return createRule({ ...input, config: assertValidRuleConfig(input.config) });
    }),

  update: procedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      updateRule(id, {
        ...updates,
        config: updates.config !== undefined ? assertValidRuleConfig(updates.config) : undefined,
        enabled: updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : undefined,
      });
      return { ok: true };
    }),

  delete: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    deleteRule(input.id);
    // The id is echoed so the caller can offer to undo without having to
    // remember what it just asked to delete.
    return { ok: true, restorable: input.id };
  }),

  /** What can still be un-deleted, for anyone who missed the toast. */
  deleted: procedure.query(() => listDeletedRules()),

  /**
   * Put deleted rules back.
   *
   * Restores the rule, not the world around it: its Plex collections were
   * deleted with it and are rebuilt by the next run, and its run history is
   * gone with the cascade. The caller says so rather than implying a fuller
   * undo than this is.
   *
   * Partial success is normal — a bulk undo where one entry has expired
   * restores the rest and reports the difference.
   */
  restore: procedure.input(z.object({ ids: z.array(z.string()).min(1).max(500) })).mutation(({ input }) => {
    const { restored, missing } = restoreDeletedRules(input.ids);
    return { restored: restored.length, missing: missing.length };
  }),

  test: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return startOrAttachRuleRun(input.id, "test");
  }),

  run: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return startOrAttachRuleRun(input.id, "run");
  }),

  /**
   * Ask a run to stop. Safe to call from any tab, or for a run this process
   * isn't executing — the executor notices the status and unwinds.
   */
  cancelRun: procedure.input(z.object({ runId: z.string() })).mutation(({ input }) => {
    const outcome = requestRuleRunCancel(input.runId);
    if (outcome) console.log(`[rule-runs] Cancel requested for run "${input.runId}" (${outcome})`);
    return { ok: outcome !== null, status: outcome };
  }),

  /** Every rule run currently queued, running or unwinding, with rule names. */
  activeRuns: procedure.query(() => getActiveRuleRuns()),

  runs: procedure
    .input(
      z.object({
        ruleId: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
        phase: z.enum(["run", "test"]).optional(),
      }),
    )
    .query(({ input }) => {
      const runs = getRuleRuns(input.ruleId, { limit: input.limit, phase: input.phase });
      // One grouped query for the whole page rather than one per row — the
      // counts are what make a list of runs scannable ("that's the night it
      // dropped 200 items"), so they can't be a per-row fetch.
      const counts = getRunChangeCounts(runs.map((r) => r.id));
      return runs.map((run) => ({ ...run, changes: counts.get(run.id) ?? { added: 0, removed: 0 } }));
    }),

  runDetail: procedure.input(z.object({ runId: z.string() })).query(({ input }) => getRuleRun(input.runId)),

  /** What this run added to and removed from each collection it touched. */
  runChanges: procedure.input(z.object({ runId: z.string() })).query(({ input }) => getRunChanges(input.runId)),

  /**
   * Put a run's collections back the way they were before it ran.
   *
   * Applied to Plex directly rather than by re-running the rule: re-running
   * would re-derive the same membership from the same sources and land exactly
   * where the run being reverted did. So the changeset is played backwards —
   * everything the run added comes out, everything it removed goes back in.
   *
   * The remembered snapshot is rewritten to match, and the changeset dropped,
   * so the next run diffs against what Plex actually holds now and the same
   * revert can't be applied twice. Note the next scheduled run will re-derive
   * the membership again: a revert buys time to fix the rule, it doesn't pin
   * the collection forever.
   */
  revertRun: procedure.input(z.object({ runId: z.string() })).mutation(async ({ input }) => {
    const run = getRuleRun(input.runId);
    if (!run) throw new Error("That run no longer exists.");
    if (run.phase !== "run") throw new Error("A test changes nothing, so there is nothing to revert.");

    const groups = getRunChanges(input.runId);
    if (groups.length === 0) return { ok: true as const, collections: 0, added: 0, removed: 0, skipped: 0 };

    const client = getPlexClient();
    const { machineIdentifier } = await client.getIdentity();
    const sections = await client.getSections();
    let addedBack = 0;
    let removedAgain = 0;
    let skipped = 0;

    for (const group of groups) {
      // No key means the collection was never committed, or was committed by a
      // run whose rows predate the key being recorded. Nothing to write to.
      if (!group.collectionRatingKey) {
        skipped++;
        continue;
      }
      try {
        if (group.removed.length > 0) {
          await client.addCollectionItems(
            group.collectionRatingKey,
            machineIdentifier,
            group.removed.map((m) => m.ratingKey),
          );
          addedBack += group.removed.length;
        }
        for (const item of group.added) {
          if (await client.removeCollectionItem(group.collectionRatingKey, item.ratingKey)) removedAgain++;
        }
        // Keep the local mirror honest about what the collection now holds —
        // the Collections page reads it, not Plex.
        const section = sections.find((s) => s.key === group.sectionKey);
        if (section) await upsertCollectionByKey(client, section, group.collectionRatingKey);
      } catch (err) {
        // One collection Plex has since deleted shouldn't strand the rest of
        // the revert — report it and carry on.
        console.warn(`[rule-runs] Revert failed for "${group.collectionName}":`, errorMessage(err));
        skipped++;
      }
    }

    // Rewrite the snapshot from the reverted membership so the next run's diff
    // is against what Plex holds now, not what this run left behind.
    for (const group of groups) {
      const remembered = getRememberedMembers(run.ruleId, group.sectionKey, group.collectionName);
      const addedKeys = new Set(group.added.map((m) => m.ratingKey));
      const reverted = [
        ...remembered.filter((m) => !addedKeys.has(m.ratingKey)),
        ...group.removed.map((m) => ({ ratingKey: m.ratingKey, title: m.title })),
      ];
      rememberMembers(run.ruleId, group.sectionKey, group.collectionName, reverted);
    }
    clearRunChanges(input.runId);

    return { ok: true as const, collections: groups.length, added: addedBack, removed: removedAgain, skipped };
  }),

  /** Incremental log slice — see `useRunLog` on the client for why. */
  runLog: procedure
    .input(z.object({ runId: z.string(), offset: z.number().int().min(0).default(0) }))
    .query(({ input }) => getRuleRunLog(input.runId, input.offset) ?? { chunk: "", nextOffset: 0, size: 0 }),

  /** Latest runs across all rules, for the Jobs dashboard. */
  recentRuns: procedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ input }) => getRecentRuleRuns(input?.limit ?? 20)),

  /** The per-rule breakdown of a Generate/Cleanup job run. */
  runsForJobRun: procedure
    .input(z.object({ jobRunId: z.string() }))
    .query(({ input }) => getRuleRunsForJobRun(input.jobRunId)),

  lastTestResult: procedure.input(z.object({ id: z.string() })).query(({ input }): PersistedTestResult | null => {
    return getLastTestResult(input.id) ?? null;
  }),

  clearTestResult: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    clearLastTestResult(input.id);
    return { ok: true };
  }),

  /** What Tinkerbell has written onto this rule's collections so far. */
  artworkStatus: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const rows = getCollectionArtworkForRule(input.id);
    return {
      collections: rows.length,
      postersUploaded: rows.filter((r) => r.posterUploadedAt).length,
      summariesWritten: rows.filter((r) => r.summary).length,
      summariesLocked: rows.filter((r) => r.summaryLockedAt).length,
      /** True where a poster replaced artwork the collection already had. */
      replacedExistingArtwork: rows.filter((r) => r.posterUploadedAt && r.priorThumb).length,
      lastUpdatedAt: rows.reduce<number | null>(
        (max, r) => (max === null || r.updatedAt > max ? r.updatedAt : max),
        null,
      ),
    };
  }),

  /**
   * Stop presenting this rule's collections, and forget what we wrote.
   *
   * Honest about its limits: the collections themselves are deleted and
   * recreated on every run, so there is no image to put back — reverting means
   * the next run uploads nothing and the collection keeps whatever Plex gives
   * it. Turning the rule's `presentation.poster` back to `none` is the other
   * half, and the caller does that through the normal update path.
   */
  revertArtwork: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const rows = getCollectionArtworkForRule(input.id);
    const replaced = rows.filter((r) => r.posterUploadedAt && r.priorThumb).length;
    const forgotten = forgetCollectionArtwork(input.id);
    return { forgotten, replacedExistingArtwork: replaced };
  }),
});
