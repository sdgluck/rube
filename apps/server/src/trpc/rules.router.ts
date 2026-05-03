import { z } from "zod";
import { getRules, getRule, createRule, updateRule, deleteRule } from "../domains/rules.ts";
import { t, procedure } from "./_base.ts";

const testControllers = new Map<string, AbortController>();
const runControllers = new Map<string, AbortController>();

export const rulesRouter = t.router({
  list: procedure.query(() => getRules()),

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
    try {
      const { testRule } = await import("../commands/generate.ts");
      return await testRule(input.id, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log(`[test-rule] Test for rule "${input.id}" was cancelled`);
      } else {
        console.error(`[test-rule] Test for rule "${input.id}" failed:`, err instanceof Error ? err.message : err);
      }
      throw err;
    } finally {
      testControllers.delete(input.id);
    }
  }),

  cancelTest: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    console.log(`[test-rule] Cancel requested for rule "${input.id}"`);
    testControllers.get(input.id)?.abort();
    testControllers.delete(input.id);
    return { ok: true };
  }),

  run: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    if (runControllers.has(input.id)) {
      console.log(`[run-rule] Aborting previous run for rule "${input.id}"`);
      runControllers.get(input.id)?.abort();
    }
    const controller = new AbortController();
    runControllers.set(input.id, controller);
    try {
      const { runSingleRule } = await import("../commands/generate.ts");
      return await runSingleRule(input.id, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log(`[run-rule] Run for rule "${input.id}" was cancelled`);
      } else {
        console.error(`[run-rule] Run for rule "${input.id}" failed:`, err instanceof Error ? err.message : err);
      }
      throw err;
    } finally {
      runControllers.delete(input.id);
    }
  }),

  cancelRun: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    console.log(`[run-rule] Cancel requested for rule "${input.id}"`);
    runControllers.get(input.id)?.abort();
    runControllers.delete(input.id);
    return { ok: true };
  }),
});
