import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { CHANGE_KINDS } from "@tinkerbell/domain.changes";

import { t, procedure } from "./_base.ts";

export function createChangesRouter(deps: Pick<TrpcDeps, "changes" | "config" | "jobs" | "rules">) {
  const { startJob } = deps.jobs;
  const { changes, config, rules } = deps;
  const { getConfig, setConfig } = config;
  const { changeFeed } = changes;
  const { restoreDeletedRules } = rules;

  const changesRouter = t.router({
    /**
     * Everything Tinkerbell has done to the library, newest first.
     *
     * A read-model over five existing tables rather than a sixth ledger — see
     * `domains/changes`. Each source is capped at `limit` and the merge re-cut,
     * so a night of heavy collection churn cannot push every metadata write off
     * the page.
     */
    feed: procedure
      .input(
        z.object({
          limit: z.number().int().min(1).max(500).default(100),
          since: z.number().int().optional(),
          kinds: z.array(z.enum(CHANGE_KINDS)).optional(),
        }),
      )
      .query(({ input }) => ({ entries: changeFeed(input) })),

    /**
     * Take one back.
     *
     * Dispatches to whatever that kind of change already knows how to reverse,
     * rather than reimplementing it: a metadata batch starts the existing
     * `metadata-undo` job, a deleted rule goes through the recycle bin. Kinds
     * with no undo never reach here — the feed marks them `none` and the page
     * renders a reason instead of a button.
     */
    undo: procedure
      .input(
        z.object({
          kind: z.enum(["metadata-batch", "restore-rule"]),
          ref: z.string().min(1),
        }),
      )
      .mutation(async ({ input }) => {
        if (input.kind === "metadata-batch") {
          // The same single-flight guard the Metadata page uses: the undo runs
          // in a worker thread and takes its batch id from config, so two
          // overlapping requests would have the second silently win.
          if (getConfig("metadata_undo_pending_batch")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "An undo is already running. Wait for it to finish before starting another.",
            });
          }
          setConfig("metadata_undo_pending_batch", input.ref);
          await startJob("metadata-undo");
          return { started: true as const };
        }

        const { restored, missing } = restoreDeletedRules([input.ref]);
        if (missing.length > 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That rule is past its restore window and its tombstone has been pruned.",
          });
        }
        return { started: false as const, restored: restored.length };
      }),
  });

  return changesRouter;
}
