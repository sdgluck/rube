import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { CHANGE_LOG_ENTITIES } from "@tinkerbell/domain.config-history";
import { assertValidRuleConfig } from "./rules.router.ts";

import { t, procedure } from "./_base.ts";

/**
 * The settings history: what you changed about Tinkerbell, and how to put one
 * of those changes back.
 *
 * Distinct from `changes.router.ts`, which is the feed of what Tinkerbell did
 * to Plex. The two are deliberately not merged — see the header of
 * `domains/config-history` — and they answer different questions: that one is
 * "why is this collection wrong", this one is "what did I do on Tuesday".
 */
export function createHistoryRouter(deps: Pick<TrpcDeps, "configHistory" | "rules">) {
  const { history, snapshot } = deps.configHistory;
  const { getRule, updateRule } = deps.rules;

  const historyRouter = t.router({
    /**
     * Newest first. With no `entity` this is the global log; with `entity` and
     * `entityId` it is the History tab on one rule.
     */
    list: procedure
      .input(
        z.object({
          entity: z.enum(CHANGE_LOG_ENTITIES).optional(),
          entityId: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(100),
          since: z.number().int().optional(),
        }),
      )
      .query(({ input }) => ({ entries: history(input) })),

    /**
     * Write an earlier version back.
     *
     * Deliberately a normal edit rather than a special path: it goes through
     * `updateRule` like any other change and records a new entry of its own.
     * That is what keeps the log an honest account of how the row reached its
     * current state, and what makes restoring a restore work without anybody
     * writing code for it.
     *
     * Only rules, for now. A config value would be a second `setConfig` and is
     * easy; a job schedule is easy too — but both would need the same
     * validation pass the rule gets below, and shipping restore for the entity
     * whose history people actually want is better than shipping three
     * half-checked ones.
     */
    restore: procedure.input(z.object({ id: z.number().int() })).mutation(({ input }) => {
      const entry = snapshot(input.id);
      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That version is no longer in the history, or it recorded a deletion rather than a state.",
        });
      }
      if (entry.entity !== "rule") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Restoring a ${entry.entity} isn't supported yet — only rules can be rolled back.`,
        });
      }
      const rule = getRule(entry.entityId);
      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That rule has since been deleted. Restore it from the recycle bin on the Rules page first.",
        });
      }

      const state = entry.after as { name?: string; enabled?: number; config?: Record<string, unknown> };

      // Re-validated rather than trusted. The snapshot was valid when it was
      // written, but "valid" is a moving target: a rule type whose schema has
      // since gained a required field would otherwise be restored into a state
      // the engine can no longer run, and the failure would surface at 1am in a
      // job log rather than here, on the button that caused it. Checked against
      // the *current* type, since a rule's type cannot be edited and the live
      // row is what the config has to satisfy.
      const config = assertValidRuleConfig(state.config ?? {}, rule.type);

      updateRule(
        entry.entityId,
        { name: state.name, enabled: state.enabled, config },
        { source: "restore", action: "restore" },
      );
      return { ok: true as const, ruleId: entry.entityId };
    }),
  });

  return historyRouter;
}
