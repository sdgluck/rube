import { z } from "zod";
import {
  getJobs,
  getJobRuns,
  getJobRun,
  getActiveRuns,
  getRecentRuns,
  updateJob,
  startJob,
  cancelRun,
} from "../jobs/runner.ts";
import { t, procedure } from "./_base.ts";

export const jobsRouter = t.router({
  list: procedure.query(() => getJobs()),

  runs: t.procedure
    .input(z.object({ jobId: z.string(), limit: z.number().optional() }))
    .query(({ input }) => getJobRuns(input.jobId, input.limit)),

  run: procedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const run = getJobRun(input.runId);
    if (!run) throw new Error(`Run ${input.runId} not found`);
    return run;
  }),

  activeRuns: procedure.query(() => getActiveRuns()),

  recentRuns: procedure.query(() => getRecentRuns()),

  update: t.procedure
    .input(
      z.object({
        jobId: z.string(),
        schedule: z.string().optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const { jobId, ...updates } = input;
      updateJob(jobId, updates);
      return { ok: true };
    }),

  start: procedure.input(z.object({ jobId: z.string() })).mutation(async ({ input }) => {
    const result = await startJob(input.jobId);
    if (!result) throw new Error(`Job ${input.jobId} is already running or not found`);
    return { runId: result.runId };
  }),

  cancel: procedure.input(z.object({ runId: z.string() })).mutation(({ input }) => {
    const ok = cancelRun(input.runId);
    if (!ok) throw new Error(`Run ${input.runId} is not running`);
    return { ok: true };
  }),
});
