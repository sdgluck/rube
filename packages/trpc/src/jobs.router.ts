import { COMMANDS, isCommandName } from "@tinkerbell/jobs";
import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { t, procedure } from "./_base.ts";

export function createJobsRouter(deps: Pick<TrpcDeps, "collections" | "jobs" | "stats">) {
  const {
    cancelRun,
    checkpointStatus,
    deferredRuleStarts,
    deferredStarts,
    discardCheckpoint,
    getActiveRuns,
    getJobRun,
    getJobRunFullLog,
    getJobRunLog,
    getJobRuns,
    getJobs,
    getRecentRuns,
    getRunsInWindow,
    installFeature,
    listFeatureCatalog,
    startJob,
    uninstallFeature,
    updateJob,
  } = deps.jobs;
  const { collections, stats } = deps;
  const { getBywCollectionsGroupedByUser } = collections;
  const { getLastFailedRun } = stats;

  const jobsRouter = t.router({
    list: procedure.query(() => getJobs()),

    /**
     * Scheduled starts currently held back — see `deferral.ts`. Read by the
     * Schedules settings page so "why hasn't this run" has an answer other than
     * reading the server log.
     *
     * Jobs and rules are reported separately because they are held by different
     * machinery — a job start waits in `schedule.ts`, a due rule waits in
     * `rule-schedules.ts` — and because "Halloween Films is waiting" and "Cleanup
     * is waiting" are different sentences to the person reading them.
     */
    deferred: procedure.query(() => ({ jobs: deferredStarts(), rules: deferredRuleStarts() })),

    /**
     * What ran, and when, over a window — for the timeline on the Jobs page.
     *
     * The runner is far more sophisticated than the UI let on: two lanes with
     * independent concurrency, scheduled starts held back while somebody is
     * streaming, a watchdog that force-fails a wedged run. None of it was
     * legible. A list of recent runs answers "what happened"; it does not answer
     * "why did the nightly job start at 02:40", which is the question people
     * actually arrive with.
     *
     * Deferred starts come back alongside the runs because they are the answer
     * to that question and they are not runs — they exist only in the
     * scheduler's memory until they either start or hit their ceiling.
     */
    timeline: procedure
      .input(
        z.object({
          windowMs: z
            .number()
            .int()
            .min(60_000)
            .max(7 * 24 * 3_600_000)
            .default(24 * 3_600_000),
        }),
      )
      .query(({ input }) => {
        const now = Date.now();
        const runs = getRunsInWindow(input.windowMs, now).map((run) => ({
          ...run,
          // The lane is a property of the command, not of the run, and it is
          // what explains why two jobs due at the same minute didn't overlap.
          lane: isCommandName(run.command) ? COMMANDS[run.command].lane : "internal",
        }));
        return { now, windowMs: input.windowMs, runs, deferred: deferredStarts() };
      }),

    /**
     * Resumable state a previous run abandoned.
     *
     * `generate` (per rule) and `sync-media` (per section) checkpoint their
     * progress so a container restart doesn't redo hours of work. That has
     * always worked silently, which means the one time it matters — a failed run
     * that will pick up where it left off — looked identical to one that will
     * start over.
     */
    checkpoint: procedure.input(z.object({ jobId: z.string() })).query(({ input }) => checkpointStatus(input.jobId)),

    /** Throw the checkpoint away, so the next run starts from scratch. */
    discardCheckpoint: procedure
      .input(z.object({ jobId: z.string() }))
      .mutation(({ input }) => ({ discarded: discardCheckpoint(input.jobId) })),

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

    /**
     * The last run that failed, ever — the same row the Stats dashboard's
     * failure tile reads, so the two pages can't report different failures.
     * `recentRuns` can't answer this: a failure drops off the end of that
     * window as soon as enough jobs have run since.
     */
    lastFailure: procedure.query(() => getLastFailedRun()),

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

  return jobsRouter;
}
