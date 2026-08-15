import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getJobs,
  getJobRuns,
  getJobRun,
  getJobRunLog,
  getJobRunFullLog,
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

  runs: procedure
    .input(z.object({ jobId: z.string(), limit: z.number().int().min(1).max(500).optional() }))
    .query(({ input }) => getJobRuns(input.jobId, input.limit)),

  /**
   * Run metadata only — the log comes from `runLog`. The UI polls this once a
   * second while a run is live, and shipping the whole log each time was the
   * single most expensive thing this API did.
   */
  run: procedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const run = getJobRun(input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
    return run;
  }),

  /**
   * Incremental log fetch. Pass back the previous `nextOffset` to get only
   * what's been appended since. `size` shrinking below the caller's offset
   * means the log was replaced — start over from 0.
   */
  runLog: procedure
    .input(z.object({ runId: z.string(), offset: z.number().int().min(0).default(0) }))
    .query(({ input }) => {
      const slice = getJobRunLog(input.runId, input.offset);
      if (!slice) throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
      return slice;
    }),

  /** Whole log in one shot, for the download affordance. */
  fullLog: procedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const text = getJobRunFullLog(input.runId);
    if (text === null) throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
    return { log: text };
  }),

  activeRuns: procedure.query(() => getActiveRuns()),

  recentRuns: procedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ input }) => getRecentRuns(input?.limit)),

  update: procedure
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
    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          throw new TRPCError({ code: "NOT_FOUND", message: `Job "${input.jobId}" does not exist` });
        case "already-running":
          throw new TRPCError({ code: "CONFLICT", message: `Job "${input.jobId}" is already running` });
        case "unknown-command":
          // The job row exists but points at a command this build doesn't have
          // — usually a downgrade, or a hand-edited row. A failed run row was
          // created with the details; point the user at it.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Job "${input.jobId}" points at a command this version doesn't have. See the run log.`,
          });
      }
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

  install: procedure
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

  uninstall: procedure.input(z.object({ featureId: z.string() })).mutation(async ({ input }) => {
    await uninstallFeature(input.featureId);
    return { ok: true };
  }),
});
