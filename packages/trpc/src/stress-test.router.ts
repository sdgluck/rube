import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { stressTestConfigInputSchema } from "@tinkerbell/jobs";

import { t, procedure } from "./_base.ts";

export function createStressTestRouter(deps: TrpcDeps) {
  const { getStressTestRuns, getStressTestRun, startStressTest, cancelStressTest, getActiveStressTest } = deps.jobs;

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

    activeRun: procedure.query(() => getActiveStressTest()),
  });
}
