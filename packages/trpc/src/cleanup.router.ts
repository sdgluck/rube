import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { DAY_MS } from "@tinkerbell/core";

import { t, procedure } from "./_base.ts";

export function createCleanupRouter(deps: Pick<TrpcDeps, "cleanup">) {
  const { cleanup } = deps;
  const {
    addProtection,
    countsByRule,
    holdCandidate,
    setCandidateApproval,
    listCandidates,
    listProtections,
    queuedCandidates,
    removeProtection,
  } = cleanup;

  /**
   * The cleanup queue.
   *
   * Read-mostly: the only mutation is the reprieve, which is deliberately the
   * one thing a user can do from here. Everything else about a cleanup rule is
   * edited on the rule itself, and offering "delete this now" from a page whose
   * whole purpose is oversight would defeat the point of the streak.
   */
  const cleanupRouter = t.router({
    /** Everything queued across every rule, closest to being actioned first. */
    queue: procedure
      .input(z.object({ includeActioned: z.boolean().default(false) }).optional())
      .query(({ input }) => queuedCandidates({ includeActioned: input?.includeActioned ?? false })),

    /**
     * How much of the daily ceiling the last 24 hours spent — the same count,
     * over the same window, that the run budget starts from, so the number
     * beside the setting is the one the next run will be held to.
     */
    capUsage: procedure.query(() => ({ used: cleanup.actionedInLastDay() })),

    /**
     * Queued/actioned tallies keyed by rule id, for the Rules table.
     *
     * One query for the whole table rather than one per row — a cleanup rule's
     * status cell needs this on every render of the list.
     */
    counts: procedure.query(() => Object.fromEntries(countsByRule())),

    /**
     * Say yes to one item, for a rule that holds destructive actions until
     * asked.
     *
     * One item per call, deliberately. The value of the gate is that somebody
     * looks at the titles, and a bulk "approve everything due" is a way of not
     * looking at them that takes one click.
     */
    approve: procedure
      .input(z.object({ ruleId: z.string(), ratingKey: z.string(), approved: z.boolean() }))
      .mutation(({ input }) => {
        setCandidateApproval(input.ruleId, input.ratingKey, input.approved);
        return { ok: true as const };
      }),

    /**
     * Standing protections — the things no cleanup rule may ever action.
     *
     * Separate from a hold, which always expires by design. This is the answer
     * to "stop asking me about this film", and to "nothing in Favourites, ever".
     */
    protections: procedure.query(() => listProtections()),

    protect: procedure
      .input(
        z.object({
          kind: z.enum(["item", "collection"]),
          value: z.string().min(1),
          label: z.string().default(""),
          note: z.string().default(""),
        }),
      )
      .mutation(({ input }) => {
        addProtection(input.kind, input.value, input.label, input.note);
        return { ok: true };
      }),

    unprotect: procedure.input(z.object({ id: z.number().int() })).mutation(({ input }) => {
      removeProtection(input.id);
      return { ok: true };
    }),

    /** One rule's queue and audit trail — the Rules page drill-down. */
    forRule: procedure.input(z.object({ ruleId: z.string() })).query(({ input }) => listCandidates(input.ruleId)),

    /**
     * "Keep this one."
     *
     * `days` of null clears the hold. A default of 90 days rather than forever:
     * an indefinite reprieve is indistinguishable from the rule being wrong, and
     * this way the item comes back for review instead of silently never being
     * considered again.
     */
    hold: procedure
      .input(
        z.object({
          ruleId: z.string(),
          ratingKey: z.string(),
          days: z.number().int().positive().nullable().default(90),
        }),
      )
      .mutation(({ input }) => {
        holdCandidate(input.ruleId, input.ratingKey, input.days == null ? null : Date.now() + input.days * DAY_MS);
        return { ok: true };
      }),

    /**
     * The same reprieve, applied to a selection.
     *
     * The queue is where somebody reviews what a scheduled deletion is about to
     * do, and reviewing it one row at a time is how a page with forty rows gets
     * skimmed instead of read. Reprieving a batch is the ordinary case, not the
     * exception.
     *
     * Returns the previous hold for each item so the caller can offer an undo —
     * this is the one page where the cost of a mis-click is a file.
     */
    holdMany: procedure
      .input(
        z.object({
          items: z
            .array(z.object({ ruleId: z.string(), ratingKey: z.string() }))
            .min(1)
            .max(500),
          days: z.number().int().positive().nullable().default(90),
        }),
      )
      .mutation(({ input }) => {
        const until = input.days == null ? null : Date.now() + input.days * DAY_MS;
        const previous: Array<{ ruleId: string; ratingKey: string; heldUntil: number | null }> = [];
        for (const item of input.items) {
          // Read before writing: an undo has to put back the hold each item
          // actually had, not a blanket "no hold" that would quietly release
          // something that was already reprieved.
          const existing = listCandidates(item.ruleId).find((c) => c.ratingKey === item.ratingKey);
          previous.push({ ...item, heldUntil: existing?.heldUntil ?? null });
          holdCandidate(item.ruleId, item.ratingKey, until);
        }
        return { ok: true as const, count: input.items.length, previous };
      }),

    /** Put back exactly the holds a `holdMany` replaced. */
    restoreHolds: procedure
      .input(
        z.object({
          items: z
            .array(z.object({ ruleId: z.string(), ratingKey: z.string(), heldUntil: z.number().nullable() }))
            .min(1)
            .max(500),
        }),
      )
      .mutation(({ input }) => {
        for (const item of input.items) holdCandidate(item.ruleId, item.ratingKey, item.heldUntil);
        return { ok: true as const, count: input.items.length };
      }),
  });

  return cleanupRouter;
}
