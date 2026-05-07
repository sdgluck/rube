import { z } from "zod";
import { like, desc } from "drizzle-orm";
import { db, collections } from "@tinkerbell/db";
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
import { t, procedure } from "./_base.ts";

const BYW_LABEL = "BecauseYouWatched";

function getBywCollectionsGrouped() {
  const rows = db
    .select()
    .from(collections)
    .where(like(collections.labels, `%"${BYW_LABEL}"%`))
    .orderBy(desc(collections.addedAt))
    .all();

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const userLabel = row.labels.find((l) => l.startsWith("User:"));
    const key = userLabel ? userLabel.slice("User:".length) : "Server-wide";
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([user, items]) => ({ user, collections: items }))
    .sort((a, b) => {
      if (a.user === "Server-wide") return -1;
      if (b.user === "Server-wide") return 1;
      return a.user.localeCompare(b.user);
    });
}

export const jobsRouter = t.router({
  list: procedure.query(() => getJobs()),

  runs: t.procedure
    .input(z.object({ jobId: z.string(), limit: z.number().int().min(1).max(500).optional() }))
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

  bywCollections: procedure.query(() => getBywCollectionsGrouped()),

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
