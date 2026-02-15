import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { getAllConfig, getConfig, setConfig, configSchema, type ConfigKey } from "./config.ts";
import { createPlexClient } from "./plex.ts";
import {
  syncCollections,
  getLocalCollections,
  getLocalCollection,
  updateCollection,
  updateCollectionLabels,
  deleteCollection,
} from "./collections.ts";
import { getJobs, getJobRuns, getJobRun, getActiveRuns, updateJob, startJob, cancelRun } from "./jobs.ts";

const t = initTRPC.create();

const configRouter = t.router({
  get: t.procedure.query(() => getAllConfig()),

  save: t.procedure.input(configSchema.partial()).mutation(({ input }) => {
    for (const key of Object.keys(input) as ConfigKey[]) {
      const value = input[key];
      if (value !== undefined) {
        setConfig(key, value);
      }
    }
    return { ok: true };
  }),
});

function getPlexClient() {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) {
    throw new Error("Plex URL and token are not configured");
  }
  return createPlexClient({ url: plexUrl, token: plexToken });
}

const collectionsRouter = t.router({
  list: t.procedure
    .input(
      z
        .object({ sectionId: z.string().optional(), label: z.string().optional(), search: z.string().optional() })
        .optional(),
    )
    .query(({ input }) => {
      return getLocalCollections(input);
    }),

  get: t.procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => {
    const row = getLocalCollection(input.ratingKey);
    if (!row) throw new Error(`Collection ${input.ratingKey} not found`);
    return row;
  }),

  items: t.procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getCollectionChildren(input.ratingKey);
  }),

  update: t.procedure
    .input(z.object({ ratingKey: z.string(), title: z.string().optional(), summary: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { ratingKey, ...updates } = input;
      const client = getPlexClient();
      await updateCollection(client, ratingKey, updates);
      return { ok: true };
    }),

  updateLabels: t.procedure
    .input(z.object({ ratingKey: z.string(), labels: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const client = getPlexClient();
      await updateCollectionLabels(client, input.ratingKey, input.labels);
      return { ok: true };
    }),

  delete: t.procedure.input(z.object({ ratingKey: z.string() })).mutation(async ({ input }) => {
    const client = getPlexClient();
    await deleteCollection(client, input.ratingKey);
    return { ok: true };
  }),

  sync: t.procedure.mutation(async () => {
    const client = getPlexClient();
    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    return syncCollections(client, sections);
  }),
});

const jobsRouter = t.router({
  list: t.procedure.query(() => getJobs()),

  runs: t.procedure
    .input(z.object({ jobId: z.string(), limit: z.number().optional() }))
    .query(({ input }) => getJobRuns(input.jobId, input.limit)),

  run: t.procedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    const run = getJobRun(input.runId);
    if (!run) throw new Error(`Run ${input.runId} not found`);
    return run;
  }),

  activeRuns: t.procedure.query(() => getActiveRuns()),

  update: t.procedure
    .input(z.object({ jobId: z.string(), schedule: z.string().optional(), enabled: z.boolean().optional() }))
    .mutation(({ input }) => {
      const { jobId, ...updates } = input;
      updateJob(jobId, updates);
      return { ok: true };
    }),

  start: t.procedure.input(z.object({ jobId: z.string() })).mutation(({ input }) => {
    const result = startJob(input.jobId);
    if (!result) throw new Error(`Job ${input.jobId} is already running or not found`);
    return { runId: result.runId };
  }),

  cancel: t.procedure.input(z.object({ runId: z.string() })).mutation(({ input }) => {
    const ok = cancelRun(input.runId);
    if (!ok) throw new Error(`Run ${input.runId} is not running`);
    return { ok: true };
  }),
});

export const appRouter = t.router({
  config: configRouter,
  collections: collectionsRouter,
  jobs: jobsRouter,

  plexSections: t.procedure.query(async () => {
    const plexUrl = getConfig("global_plex_url");
    const plexToken = getConfig("global_plex_token");
    if (!plexUrl || !plexToken) {
      throw new Error("Plex URL and token are not configured");
    }
    const sectionsUrl = new URL("/library/sections", plexUrl);
    sectionsUrl.searchParams.set("X-Plex-Token", plexToken);
    const pRes = await fetch(sectionsUrl.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!pRes.ok) {
      throw new Error(`Plex returned ${pRes.status} ${pRes.statusText}`);
    }
    const data = await pRes.json();
    const directories: Array<{ key: string; title: string; type: string }> = data?.MediaContainer?.Directory || [];
    return directories.map((d) => ({
      key: d.key,
      title: d.title,
      type: d.type,
    }));
  }),

  testPlex: t.procedure
    .input(z.object({ plex_url: z.string(), plex_token: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const testUrl = new URL("/", input.plex_url);
        testUrl.searchParams.set("X-Plex-Token", input.plex_token);
        const pRes = await fetch(testUrl.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!pRes.ok) {
          return {
            ok: false as const,
            error: `Plex returned ${pRes.status} ${pRes.statusText}`,
          };
        }
        const data = await pRes.json();
        const name = data?.MediaContainer?.friendlyName || "Unknown";
        return { ok: true as const, serverName: name };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    }),
});

export type AppRouter = typeof appRouter;
