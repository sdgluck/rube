import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { stressTestConfigInputSchema } from "@rube/jobs";
import { TRPCError } from "@trpc/server";

import { t, procedure } from "./_base.ts";

export function createStressTestRouter(deps: TrpcDeps) {
  const {
    getStressTestRuns,
    getStressTestRun,
    getStressTestRunLog,
    startStressTest,
    cancelStressTest,
    getActiveStressTest,
  } = deps.jobs;

  return t.router({
    runs: procedure.query(() => getStressTestRuns()),
    run: procedure.input(z.object({ id: z.string() })).query(({ input }) => getStressTestRun(input.id)),

    // The input schema is imported rather than restated. It used to be an
    // inline copy of bare `z.number()`s, so the UI's 1–50 was the only bound
    // anywhere and an API caller could ask for a hundred thousand real
    // transcode sessions against their own server.
    start: procedure.input(stressTestConfigInputSchema).mutation(({ input }) => startStressTest(input)),

    cancel: procedure.mutation(() => {
      cancelStressTest();
      return { ok: true };
    }),

    /**
     * The live run's state and only the telemetry the caller has not seen.
     *
     * `sinceT` is the last sample `t` the caller holds; the cockpit polls this
     * once a second and accumulates. Shipping the whole series each time — a
     * thousand samples with their per-session readings attached — would make
     * watching the run more expensive than running it, which is the mistake
     * `jobs.runLog` was split out to fix.
     */
    activeRun: procedure
      .input(z.object({ sinceT: z.number().int().min(-1).default(-1) }).optional())
      .query(({ input }) => getActiveStressTest(input?.sinceT ?? -1)),

    /** Incremental log fetch. Pass back the previous `nextOffset`. */
    runLog: procedure
      .input(z.object({ runId: z.string(), offset: z.number().int().min(0).default(0) }))
      .query(({ input }) => {
        const slice = getStressTestRunLog(input.runId, input.offset);
        if (!slice) throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
        return slice;
      }),
  });
}
