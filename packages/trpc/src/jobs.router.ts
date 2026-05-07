import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getJobs,
  getJobRuns,
  getJobRun,
  getActiveRuns,
  getRecentRuns,
  updateJob,
  startJob,
  cancelRun,
  installFeature,
  uninstallFeature,
  listFeatureCatalog,
} from "@tinkerbell/jobs";
import { getBywCollectionsGroupedByUser } from "@tinkerbell/domain.collections";
import { t, procedure } from "./_base.ts";

export const jobsRouter = t.router({
  list: procedure.query(() => getJobs()),

  runs: t.procedure
    .input(z.object({ jobId: z.string(), limit: z.number().int().min(1).max(500).optional() }))
    .query(({ input }) => getJobRuns(input.jobId, input.limit)),

  run: procedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const run = getJobRun(input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
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
    if (!result) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Job ${input.jobId} is already running or not found`,
      });
    }
    return { runId: result.runId };
  }),

  cancel: procedure.input(z.object({ runId: z.string() })).mutation(({ input }) => {
    const ok = cancelRun(input.runId);
    if (!ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Run ${input.runId} is not running` });
    }
    return { ok: true };
  }),

  bywCollections: procedure.query(() => getBywCollectionsGroupedByUser()),

  featureCatalog: procedure.query(() => listFeatureCatalog()),

  install: t.procedure
    .input(
      z.object({
        featureId: z.string(),
        schedule: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ input }) => {
      installFeature(input.featureId, { schedule: input.schedule, config: input.config });
      return { ok: true };
    }),

  uninstall: t.procedure.input(z.object({ featureId: z.string() })).mutation(async ({ input }) => {
    await uninstallFeature(input.featureId);
    return { ok: true };
  }),
});
