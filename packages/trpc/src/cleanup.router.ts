import { z } from "zod";
import { DAY_MS } from "@tinkerbell/core";
import { countsByRule, holdCandidate, listCandidates, queuedCandidates } from "@tinkerbell/domain.cleanup";
import { t, procedure } from "./_base.ts";

/**
 * The cleanup queue.
 *
 * Read-mostly: the only mutation is the reprieve, which is deliberately the
 * one thing a user can do from here. Everything else about a cleanup rule is
 * edited on the rule itself, and offering "delete this now" from a page whose
 * whole purpose is oversight would defeat the point of the streak.
 */
export const cleanupRouter = t.router({
  /** Everything queued across every rule, closest to being actioned first. */
  queue: procedure
    .input(z.object({ includeActioned: z.boolean().default(false) }).optional())
    .query(({ input }) => queuedCandidates({ includeActioned: input?.includeActioned ?? false })),

  /**
   * Queued/actioned tallies keyed by rule id, for the Rules table.
   *
   * One query for the whole table rather than one per row — a cleanup rule's
   * status cell needs this on every render of the list.
   */
  counts: procedure.query(() => Object.fromEntries(countsByRule())),

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
});
