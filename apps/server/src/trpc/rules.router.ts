import { z } from "zod";
import {
  getRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  setRuleLastRun,
  setRuleLastTest,
} from "#domains/rules.ts";
import {
  getRuleProgress,
  clearProgress,
  setLastTestResult,
  getLastTestResult,
  clearLastTestResult,
  hasLastTestResult,
  createTrackedContext,
  type RuleProgressState,
  type PersistedTestResult,
} from "#domains/rule-progress.ts";
import { errorMessage } from "#lib/util.ts";
import { t, procedure } from "./_base.ts";

const testControllers = new Map<string, AbortController>();
const runControllers = new Map<string, AbortController>();
// Tracks the in-flight promise for the most recent run of each rule so a
// second `run` call serializes after the first instead of racing it. Aborting
// the old controller alone wasn't enough — abort is async, the old run can
// still be mid-commit when the new one starts, and Plex permits same-title
// collections so both end up creating real duplicates.
const runPromises = new Map<string, Promise<unknown>>();

export const rulesRouter = t.router({
  list: procedure.query(() => {
    return getRules().map((r) => ({ ...r, hasTestResult: hasLastTestResult(r.id) }));
  }),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const rule = getRule(input.id);
    if (!rule) throw new Error(`Rule ${input.id} not found`);
    return rule;
  }),

  create: t.procedure
    .input(z.object({ name: z.string(), type: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => {
      return createRule(input);
    }),

  update: t.procedure
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
        enabled: updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : undefined,
      });
      return { ok: true };
    }),

  delete: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    deleteRule(input.id);
    return { ok: true };
  }),

  test: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    if (testControllers.has(input.id)) {
      console.log(`[test-rule] Aborting previous test for rule "${input.id}"`);
      testControllers.get(input.id)?.abort();
    }
    const controller = new AbortController();
    testControllers.set(input.id, controller);
    const ctx = createTrackedContext(input.id, "test", controller.signal, "[test-rule]");
    const startedAt = Date.now();
    try {
      const { testRule } = await import("#commands/generate.ts");
      const result = await testRule(input.id, controller.signal, ctx);
      const totalItems = result.collections.reduce((sum, c) => sum + c.items.length, 0);
      const persisted: PersistedTestResult = {
        ruleId: input.id,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "ok",
        collections: result.collections,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      };
      setLastTestResult(persisted);
      setRuleLastTest(input.id, {
        status: "ok",
        durationMs: persisted.durationMs,
        collectionCount: result.collections.length,
        itemCount: totalItems,
      });
      return result;
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      const status = aborted ? "cancelled" : "error";
      if (aborted) {
        console.log(`[test-rule] Test for rule "${input.id}" was cancelled`);
      } else {
        console.error(`[test-rule] Test for rule "${input.id}" failed:`, errorMessage(err));
      }
      setRuleLastTest(input.id, {
        status,
        durationMs: Date.now() - startedAt,
        error: aborted ? undefined : errorMessage(err),
      });
      throw err;
    } finally {
      testControllers.delete(input.id);
      clearProgress(input.id);
    }
  }),

  cancelTest: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    console.log(`[test-rule] Cancel requested for rule "${input.id}"`);
    testControllers.get(input.id)?.abort();
    testControllers.delete(input.id);
    return { ok: true };
  }),

  run: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    // Wait for any in-flight run of this same rule to fully settle before
    // starting a new one. Without this serialization two concurrent runs
    // both pass deleteOldCollections and both call createCollectionWithLabel,
    // producing duplicate same-title collections in Plex.
    const prior = runPromises.get(input.id);
    if (prior) {
      console.log(`[run-rule] Aborting previous run for rule "${input.id}" and waiting for it to finish`);
      runControllers.get(input.id)?.abort();
      await prior.catch(() => {});
    }

    const controller = new AbortController();
    runControllers.set(input.id, controller);
    const ctx = createTrackedContext(input.id, "run", controller.signal, "[run-rule]");
    const startedAt = Date.now();

    const work = (async () => {
      try {
        const { runSingleRule } = await import("#commands/generate.ts");
        const result = await runSingleRule(input.id, controller.signal, ctx);
        setRuleLastRun(input.id, {
          status: "ok",
          durationMs: Date.now() - startedAt,
          collectionCount: result.collectionCount,
          itemCount: result.itemCount,
        });
        return result;
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        const status = aborted ? "cancelled" : "error";
        if (aborted) {
          console.log(`[run-rule] Run for rule "${input.id}" was cancelled`);
        } else {
          console.error(`[run-rule] Run for rule "${input.id}" failed:`, errorMessage(err));
        }
        setRuleLastRun(input.id, {
          status,
          durationMs: Date.now() - startedAt,
          error: aborted ? undefined : errorMessage(err),
        });
        throw err;
      } finally {
        runControllers.delete(input.id);
        clearProgress(input.id);
      }
    })();

    runPromises.set(input.id, work);
    try {
      return await work;
    } finally {
      // Clear only if our promise is still the current one — a later run
      // may have already replaced it via the prior-await branch above.
      if (runPromises.get(input.id) === work) runPromises.delete(input.id);
    }
  }),

  cancelRun: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    console.log(`[run-rule] Cancel requested for rule "${input.id}"`);
    runControllers.get(input.id)?.abort();
    runControllers.delete(input.id);
    return { ok: true };
  }),

  progress: procedure.input(z.object({ id: z.string() })).query(({ input }): RuleProgressState | null => {
    return getRuleProgress(input.id) ?? null;
  }),

  lastTestResult: procedure.input(z.object({ id: z.string() })).query(({ input }): PersistedTestResult | null => {
    return getLastTestResult(input.id) ?? null;
  }),

  clearTestResult: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    clearLastTestResult(input.id);
    return { ok: true };
  }),
});
