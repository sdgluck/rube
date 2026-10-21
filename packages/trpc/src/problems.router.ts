import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ProblemFixError } from "@rube/domain.problems";

import { t, procedure } from "./_base.ts";
import { NativeAdmin, ProblemKind } from "@rube/contracts/native-api";

const target = z.object({ kind: ProblemKind, subject: z.string().min(1) });

/**
 * A fix that can't be attempted is the caller's problem (412); one that
 * reached Plex and failed is upstream's (502). Lumping both into a 500 sent
 * people looking at Rube's logs for what Plex had said.
 */
async function mapFixErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if (err instanceof ProblemFixError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    throw new TRPCError({ code: "BAD_GATEWAY", message: err instanceof Error ? err.message : String(err) });
  }
}

export function createProblemsRouter(deps: Pick<TrpcDeps, "problems" | "jobs">) {
  const { problems } = deps;
  const { startJob } = deps.jobs;

  return t.router({
    /** Every problem, dismissed ones included and marked, plus when shows were last compared. */
    list: procedure.output(NativeAdmin.ProblemsListOutput).query(() => problems.list()),

    fix: procedure
      .input(target)
      .output(NativeAdmin.ProblemsFixOutput)
      .mutation(({ input }) => mapFixErrors(() => problems.fix(input.kind, input.subject))),

    /** Every open fixable problem of a kind, or only `subjects` — a selection on the page. */
    fixAll: procedure
      .input(z.object({ kind: ProblemKind, subjects: z.array(z.string().min(1)).max(2000).optional() }))
      .output(NativeAdmin.ProblemsFixAllOutput)
      .mutation(({ input }) => mapFixErrors(() => problems.fixAll(input.kind, input.subjects))),

    dismiss: procedure.input(target).mutation(({ input }) => {
      try {
        problems.dismiss(input.kind, input.subject);
      } catch (err) {
        if (err instanceof ProblemFixError) throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        throw err;
      }
    }),

    undismiss: procedure.input(target).mutation(({ input }) => problems.undismiss(input.kind, input.subject)),

    /** A page's selection in one call — one detection pass, not one per row. */
    dismissMany: procedure
      .input(z.object({ targets: z.array(target).min(1).max(2000) }))
      .mutation(({ input }) => problems.dismissMany(input.targets)),

    undismissMany: procedure
      .input(z.object({ targets: z.array(target).min(1).max(2000) }))
      .mutation(({ input }) => problems.undismissMany(input.targets)),

    /**
     * Run the scan now. With a subject, only that show is re-fetched — the
     * rest keep their signatures, so the run is seconds rather than minutes.
     */
    rescan: procedure
      .input(z.object({ subject: z.string().optional() }).optional())
      .output(NativeAdmin.ProblemsRescanOutput)
      .mutation(async ({ input }) => {
        if (input?.subject) problems.recheck(input.subject);
        const result = await startJob("scan-problems");
        if (!result.ok && result.reason !== "already-running") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Couldn't start the scan (${result.reason}).` });
        }
        return result;
      }),
  });
}
