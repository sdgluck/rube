import { z } from "zod";
import {
  getStressTestRuns,
  getStressTestRun,
  startStressTest,
  cancelStressTest,
  getActiveStressTest,
} from "#jobs/stress-test/index.ts";
import { t, procedure } from "./_base.ts";

export const stressTestRouter = t.router({
  runs: procedure.query(() => getStressTestRuns()),
  run: procedure.input(z.object({ id: z.string() })).query(({ input }) => getStressTestRun(input.id)),

  start: procedure
    .input(
      z.object({
        mode: z.enum(["transcode", "directplay", "mixed"]),
        transcodePct: z.number().optional(),
        maxSessions: z.number().optional(),
      }),
    )
    .mutation(({ input }) => startStressTest(input)),

  cancel: procedure.mutation(() => {
    cancelStressTest();
    return { ok: true };
  }),

  activeRun: procedure.query(() => getActiveStressTest()),
});
