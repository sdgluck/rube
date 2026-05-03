import { initTRPC } from "@trpc/server";
import { errorMessage } from "./lib/util.ts";
import { z } from "zod";
import { getAllConfig, getConfig, setConfig, configSchema, type ConfigKey } from "./lib/config.ts";
import { createPlexClient, type PlexClient } from "./clients/plex.ts";
import { getLocalMediaItems } from "./domains/media.ts";
import {
  syncCollections,
  getLocalCollections,
  getLocalCollection,
  getCollectionFilters,
  updateCollection,
  updateCollectionLabels,
  deleteCollection,
} from "./domains/collections.ts";
import {
  getJobs,
  getJobRuns,
  getJobRun,
  getActiveRuns,
  getRecentRuns,
  updateJob,
  startJob,
  cancelRun,
} from "./jobs/runner.ts";
import { getRules, getRule, createRule, updateRule, deleteRule } from "./domains/rules.ts";
import {
  getOverlayConfigs,
  setOverlayConfig,
  removeOverlayConfig,
  clearOverlayConfigs,
  getOverlaidItemCount,
  resolveOverlayValue,
  compositeOverlays,
  overlayPositionSchema,
  overlayTypeSchema,
  type Badge,
} from "./domains/overlays.ts";
import { extractImdbId, getOmdbRatings } from "./clients/omdb.ts";
import {
  reportHealth,
  getHealthLatest,
  getHealthHistory,
  HEALTH_SERVICES,
  checkServiceHealth,
  testArrConnection,
} from "./domains/health.ts";
import {
  getCachedRecentlyAdded,
  getCachedMostWatched,
  getLibraryOverview,
  getCachedActivitySummary,
  getOpsSummary,
} from "./domains/stats.ts";
import { syncSections, getLocalSections } from "./domains/sections.ts";
import { syncUsers, getLocalUsers, updateUser } from "./domains/users.ts";
import { getPreviewForUser } from "./domains/preview.ts";
import { shuffleAllSections } from "./domains/shuffle-hubs.ts";
import { getEvents, getEventTypes } from "./domains/events.ts";
import { sendNotification, EVENT_TYPES, NOTIFICATION_SERVICES } from "./domains/notifications.ts";
import {
  getStressTestRuns,
  getStressTestRun,
  startStressTest,
  cancelStressTest,
  getActiveStressTest,
} from "./jobs/stress-test/index.ts";

const t = initTRPC.create();

const logDuration = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`[trpc] ${type} ${path} — ${ms}ms`);
  return result;
});

const procedure = t.procedure.use(logDuration);

const configRouter = t.router({
  get: procedure.query(() => getAllConfig()),

  save: procedure.input(configSchema.partial()).mutation(({ input }) => {
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
      z.object({
        sectionId: z.string().optional(),
        label: z.string().optional(),
        search: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().default(50),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      return getLocalCollections({
        sectionId: input.sectionId,
        label: input.label,
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        sort: input.sort,
        sortDir: input.sortDir,
      });
    }),

  filters: procedure.query(() => {
    return getCollectionFilters();
  }),

  get: procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => {
    const row = getLocalCollection(input.ratingKey);
    if (!row) throw new Error(`Collection ${input.ratingKey} not found`);
    return row;
  }),

  items: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
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

  delete: procedure.input(z.object({ ratingKey: z.string() })).mutation(async ({ input }) => {
    const client = getPlexClient();
    await deleteCollection(client, input.ratingKey);
    return { ok: true };
  }),

  smartConfig: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getSmartCollectionContent(input.ratingKey);
  }),

  filterFieldValues: procedure
    .input(z.object({ sectionId: z.string(), field: z.string() }))
    .query(async ({ input }) => {
      const client = getPlexClient();
      return client.getFilterFieldValues(input.sectionId, input.field);
    }),

  updateSmartFilters: t.procedure
    .input(z.object({ ratingKey: z.string(), contentUri: z.string() }))
    .mutation(async ({ input }) => {
      const client = getPlexClient();
      await client.updateSmartCollectionContent(input.ratingKey, input.contentUri);
      return { ok: true };
    }),

  sync: procedure.mutation(async () => {
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

const statsRouter = t.router({
  sessions: procedure.query(async () => {
    const client = getPlexClient();
    return client.getActiveSessions();
  }),
  recentlyAdded: procedure.query(() => getCachedRecentlyAdded()),
  mostWatched: procedure.query(() => getCachedMostWatched()),
  overview: procedure.query(() => getLibraryOverview()),
  activity: procedure.query(() => getCachedActivitySummary()),
  ops: procedure.query(() => getOpsSummary()),
});

const usersRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        search: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().default(50),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(async ({ input }) => {
      const result = getLocalUsers({
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        sort: input.sort,
        sortDir: input.sortDir,
      });

      // If cache is empty, sync live and retry
      if (result.total === 0 && !input.search) {
        try {
          const client = getPlexClient();
          await syncUsers(client);
          return getLocalUsers({
            search: input.search || undefined,
            offset: input.offset,
            limit: input.limit,
            sort: input.sort,
            sortDir: input.sortDir,
          });
        } catch {
          return result;
        }
      }

      return result;
    }),

  update: t.procedure.input(z.object({ userId: z.number(), name: z.string().optional() })).mutation(({ input }) => {
    updateUser(input.userId, { name: input.name || null });
    return { ok: true };
  }),
});

const testControllers = new Map<string, AbortController>();
const runControllers = new Map<string, AbortController>();

const rulesRouter = t.router({
  list: procedure.query(() => getRules()),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const rule = getRule(input.id);
    if (!rule) throw new Error(`Rule ${input.id} not found`);
    return rule;
  }),

  create: t.procedure
    .input(z.object({ name: z.string(), type: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => {
      return createRule(input);
    }),

  update: t.procedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      updateRule(id, {
        ...updates,
        enabled: updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : undefined,
      });
      return { ok: true };
    }),

  delete: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    deleteRule(input.id);
    return { ok: true };
  }),

  test: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    if (testControllers.has(input.id)) {
      console.log(`[test-rule] Aborting previous test for rule "${input.id}"`);
      testControllers.get(input.id)?.abort();
    }
    const controller = new AbortController();
    testControllers.set(input.id, controller);
    try {
      const { testRule } = await import("./commands/generate.ts");
      return await testRule(input.id, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log(`[test-rule] Test for rule "${input.id}" was cancelled`);
      } else {
        console.error(`[test-rule] Test for rule "${input.id}" failed:`, err instanceof Error ? err.message : err);
      }
      throw err;
    } finally {
      testControllers.delete(input.id);
    }
  }),

  cancelTest: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    console.log(`[test-rule] Cancel requested for rule "${input.id}"`);
    testControllers.get(input.id)?.abort();
    testControllers.delete(input.id);
    return { ok: true };
  }),

  run: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    if (runControllers.has(input.id)) {
      console.log(`[run-rule] Aborting previous run for rule "${input.id}"`);
      runControllers.get(input.id)?.abort();
    }
    const controller = new AbortController();
    runControllers.set(input.id, controller);
    try {
      const { runSingleRule } = await import("./commands/generate.ts");
      return await runSingleRule(input.id, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log(`[run-rule] Run for rule "${input.id}" was cancelled`);
      } else {
        console.error(`[run-rule] Run for rule "${input.id}" failed:`, err instanceof Error ? err.message : err);
      }
      throw err;
    } finally {
      runControllers.delete(input.id);
    }
  }),

  cancelRun: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    console.log(`[run-rule] Cancel requested for rule "${input.id}"`);
    runControllers.get(input.id)?.abort();
    runControllers.delete(input.id);
    return { ok: true };
  }),
});

const mediaRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        sectionId: z.string().optional(),
        type: z.string().optional(),
        search: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().default(50),
        videoResolution: z.string().optional(),
        videoCodec: z.string().optional(),
        audioCodec: z.string().optional(),
        audioChannels: z.number().optional(),
        container: z.string().optional(),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      return getLocalMediaItems({
        sectionId: input.sectionId,
        type: input.type,
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        videoResolution: input.videoResolution || undefined,
        videoCodec: input.videoCodec || undefined,
        audioCodec: input.audioCodec || undefined,
        audioChannels: input.audioChannels || undefined,
        container: input.container || undefined,
        sort: input.sort,
        sortDir: input.sortDir,
      });
    }),

  get: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    const detail = await client.getItemDetail(input.ratingKey);

    const enrichedCollections = detail.collections.map((col) => {
      const local = getLocalCollection(String(col.id));
      return {
        ratingKey: String(col.id),
        title: col.tag,
        isLocal: !!local,
        sectionTitle: local?.sectionTitle,
      };
    });

    return {
      ...detail,
      collections: enrichedCollections,
    };
  }),

  children: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getMetadataChildren(input.ratingKey);
  }),

  columns: procedure.query(() => {
    return getConfig("media_columns") ?? null;
  }),

  saveColumns: procedure.input(z.array(z.object({ id: z.string(), visible: z.boolean() }))).mutation(({ input }) => {
    setConfig("media_columns", input);
    return { ok: true };
  }),
});

/**
 * For shows, media info lives on episodes, not on the show itself.
 * Traverse show → first season → first episode to get media info.
 */
async function getMediaInfoForItem(
  client: PlexClient,
  detail: {
    ratingKey: string;
    type: string;
    media: Array<{
      videoResolution?: string;
      videoCodec?: string;
      audioCodec?: string;
      audioChannels?: number;
      bitDepth?: number;
      colorSpace?: string;
      videoDisplayTitle?: string;
    }>;
  },
) {
  if (detail.media.length > 0) return detail.media[0];

  if (detail.type === "show") {
    const seasons = await client.getMetadataChildren(detail.ratingKey);
    if (seasons.length > 0) {
      const episodes = await client.getMetadataChildren(seasons[0].ratingKey);
      if (episodes.length > 0) {
        const ep = await client.getItemFullDetail(episodes[0].ratingKey);
        if (ep.media.length > 0) return ep.media[0];
      }
    }
  } else if (detail.type === "season") {
    const episodes = await client.getMetadataChildren(detail.ratingKey);
    if (episodes.length > 0) {
      const ep = await client.getItemFullDetail(episodes[0].ratingKey);
      if (ep.media.length > 0) return ep.media[0];
    }
  }

  return {};
}

const overlaysRouter = t.router({
  configs: t.procedure
    .input(z.object({ sectionId: z.string() }))
    .query(({ input }) => getOverlayConfigs(input.sectionId)),

  setConfig: t.procedure
    .input(
      z.object({
        sectionId: z.string(),
        position: overlayPositionSchema,
        overlayType: overlayTypeSchema,
      }),
    )
    .mutation(({ input }) => {
      setOverlayConfig(input.sectionId, input.position, input.overlayType);
      return { ok: true };
    }),

  removeConfig: t.procedure
    .input(z.object({ sectionId: z.string(), position: overlayPositionSchema }))
    .mutation(({ input }) => {
      removeOverlayConfig(input.sectionId, input.position);
      return { ok: true };
    }),

  clearConfigs: procedure.input(z.object({ sectionId: z.string() })).mutation(({ input }) => {
    clearOverlayConfigs(input.sectionId);
    return { ok: true };
  }),

  status: t.procedure
    .input(z.object({ sectionId: z.string() }))
    .query(({ input }) => ({ count: getOverlaidItemCount(input.sectionId) })),

  sampleItem: procedure.input(z.object({ sectionId: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    // Get a random item from the section
    const result = await client.getItems(input.sectionId, { offset: 0, size: 1 });
    if (result.items.length === 0) return null;
    // Pick a random offset
    const randomOffset = Math.floor(Math.random() * result.total);
    const randomResult = await client.getItems(input.sectionId, { offset: randomOffset, size: 1 });
    const item = randomResult.items[0] || result.items[0];
    const detail = await client.getItemFullDetail(item.ratingKey);
    return detail;
  }),

  previewValues: t.procedure
    .input(z.object({ sectionId: z.string(), ratingKey: z.string() }))
    .query(async ({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      if (configs.length === 0) return {};

      const client = getPlexClient();
      const detail = await client.getItemFullDetail(input.ratingKey);
      const mediaInfo = await getMediaInfoForItem(client, detail);

      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");

      let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
      if (needsOmdb) {
        const imdbId = extractImdbId(detail.guids);
        if (imdbId) {
          const omdb = await getOmdbRatings(imdbId);
          if (omdb) ratings = omdb;
        }
      }

      const values: Record<string, string | null> = {};
      for (const cfg of configs) {
        values[cfg.position] = resolveOverlayValue(
          cfg.overlayType,
          {
            videoResolution: mediaInfo.videoResolution,
            videoCodec: mediaInfo.videoCodec,
            audioCodec: mediaInfo.audioCodec,
            audioChannels: mediaInfo.audioChannels,
            bitDepth: mediaInfo.bitDepth,
            colorSpace: mediaInfo.colorSpace,
            videoDisplayTitle: mediaInfo.videoDisplayTitle,
            contentRating: detail.contentRating,
            duration: detail.duration,
            studio: detail.studio,
            editionTitle: detail.editionTitle,
          },
          ratings,
        );
      }
      return values;
    }),

  testOverlay: t.procedure
    .input(z.object({ sectionId: z.string(), ratingKey: z.string() }))
    .mutation(async ({ input }) => {
      const configs = getOverlayConfigs(input.sectionId);
      if (configs.length === 0) throw new Error("No overlays configured for this section");

      const client = getPlexClient();
      const detail = await client.getItemFullDetail(input.ratingKey);
      if (!detail.thumb) throw new Error("Item has no poster");

      const mediaInfo = await getMediaInfoForItem(client, detail);
      const needsOmdb = configs.some((c) => c.overlayType === "imdb_rating" || c.overlayType === "rt_rating");

      let ratings: { imdbRating?: string | null; rtRating?: string | null } = {};
      if (needsOmdb) {
        const imdbId = extractImdbId(detail.guids);
        if (imdbId) {
          const omdb = await getOmdbRatings(imdbId);
          if (omdb) ratings = omdb;
        }
      }

      const badges: Badge[] = [];
      for (const cfg of configs) {
        const value = resolveOverlayValue(
          cfg.overlayType,
          {
            videoResolution: mediaInfo.videoResolution,
            videoCodec: mediaInfo.videoCodec,
            audioCodec: mediaInfo.audioCodec,
            audioChannels: mediaInfo.audioChannels,
            bitDepth: mediaInfo.bitDepth,
            colorSpace: mediaInfo.colorSpace,
            videoDisplayTitle: mediaInfo.videoDisplayTitle,
            contentRating: detail.contentRating,
            duration: detail.duration,
            studio: detail.studio,
            editionTitle: detail.editionTitle,
          },
          ratings,
        );
        if (value) {
          badges.push({
            position: cfg.position,
            type: cfg.overlayType,
            value,
          });
        }
      }

      if (badges.length === 0) throw new Error("No overlay values resolved for this item");

      const posterBuf = await client.downloadPoster(detail.thumb);
      const composited = await compositeOverlays(posterBuf, badges);

      return { image: composited.toString("base64") };
    }),
});

const healthRouter = t.router({
  status: procedure.query(() => {
    const serviceNames = HEALTH_SERVICES.map((s) => s.service);
    const entries = getHealthLatest(serviceNames);
    const cfg = getAllConfig();

    return HEALTH_SERVICES.map((svc) => {
      const entry = entries.find((e) => e.service === svc.service);
      return {
        service: svc.service,
        configured: svc.configuredFn(cfg),
        status: entry?.status ?? null,
        message: entry?.message ?? null,
        timestamp: entry?.timestamp ?? null,
      };
    });
  }),

  history: procedure.input(z.object({ hours: z.number().default(24) })).query(({ input }) => {
    const since = Date.now() - input.hours * 60 * 60 * 1000;
    const result: Record<string, Array<{ status: string; timestamp: number }>> = {};
    for (const svc of HEALTH_SERVICES) {
      result[svc.service] = getHealthHistory(svc.service, since);
    }
    return result;
  }),

  check: procedure.input(z.object({ service: z.string() })).mutation(async ({ input }) => {
    try {
      await checkServiceHealth(input.service);
      return { ok: true as const };
    } catch (err) {
      reportHealth(input.service, "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),
});

const eventsRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
        type: z.string().optional(),
        search: z.string().optional(),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(({ input }) => getEvents(input)),

  types: procedure.query(() => getEventTypes()),
});

const previewRouter = t.router({
  home: procedure
    .input(z.object({ userId: z.number().nullable(), sectionId: z.number().nullable().optional() }))
    .query(async ({ input }) => {
      const client = getPlexClient();
      return getPreviewForUser(client, input.userId, input.sectionId ?? null);
    }),

  shuffleHubs: procedure.mutation(async () => {
    const client = getPlexClient();
    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    const results = await shuffleAllSections(client, sections);
    const totalShuffled = results.reduce((sum, r) => sum + r.shuffled, 0);
    return { results, totalShuffled, sections: sections.length };
  }),
});

const stressTestRouter = t.router({
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

export const appRouter = t.router({
  config: configRouter,
  collections: collectionsRouter,
  media: mediaRouter,
  jobs: jobsRouter,
  rules: rulesRouter,
  users: usersRouter,
  stats: statsRouter,
  overlays: overlaysRouter,
  events: eventsRouter,
  health: healthRouter,
  stressTest: stressTestRouter,
  preview: previewRouter,

  plexSections: procedure.query(async () => {
    const cached = getLocalSections();
    if (cached.length > 0) return cached;

    // Cache empty (first run) — fetch live and populate
    const client = getPlexClient();
    const sections = await client.getSections();
    await syncSections(client);
    return sections.map((s) => ({ key: s.key, title: s.title, type: s.type }));
  }),

  refreshSections: procedure.mutation(async () => {
    const client = getPlexClient();
    const stats = await syncSections(client);
    const sections = getLocalSections();
    return { sections, synced: stats.synced, removed: stats.removed };
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
        reportHealth("Plex", "ok", `Connected — ${name}`);
        return { ok: true as const, serverName: name };
      } catch (err) {
        reportHealth("Plex", "error", errorMessage(err));
        return { ok: false as const, error: errorMessage(err) };
      }
    }),

  testRadarr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const instanceName = await testArrConnection(input.url, input.api_key);
      reportHealth("Radarr", "ok", `Connected — ${instanceName}`);
      return { ok: true as const, instanceName };
    } catch (err) {
      reportHealth("Radarr", "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),

  testSonarr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const instanceName = await testArrConnection(input.url, input.api_key);
      reportHealth("Sonarr", "ok", `Connected — ${instanceName}`);
      return { ok: true as const, instanceName };
    } catch (err) {
      reportHealth("Sonarr", "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),

  testSeerr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const { testSeerrConnection } = await import("./clients/seerr.ts");
      const data = await testSeerrConnection(input.url, input.api_key);
      reportHealth("Seerr", "ok", `Connected — ${data.total} total requests`);
      return { ok: true as const, total: data.total };
    } catch (err) {
      reportHealth("Seerr", "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),

  testOmdb: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const res = await fetch(`https://www.omdbapi.com/?apikey=${input.api_key}&t=Inception`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.Response === "False") throw new Error(data.Error || "Invalid API key");
      reportHealth("OMDB", "ok", `Test query OK — ${data.Title}`);
      return { ok: true as const, title: data.Title as string };
    } catch (err) {
      reportHealth("OMDB", "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),

  testMdblist: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const res = await fetch(`https://mdblist.com/api/user/?apikey=${input.api_key}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const name = (data.name || data.username || "OK") as string;
      reportHealth("MDBList", "ok", `Connected — ${name}`);
      return { ok: true as const, name };
    } catch (err) {
      reportHealth("MDBList", "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),

  testNotification: procedure
    .input(
      z.object({
        service: z.enum(NOTIFICATION_SERVICES),
      }),
    )
    .mutation(async ({ input }) => {
      const HEALTH_NAMES: Record<string, string> = {
        pushover: "Pushover",
        discord: "Discord",
        gotify: "Gotify",
        lunasea: "LunaSea",
        pushbullet: "Pushbullet",
        slack: "Slack",
        telegram: "Telegram",
        webhook: "Webhook",
      };
      const healthName = HEALTH_NAMES[input.service] ?? input.service;
      try {
        await sendNotification(
          input.service as (typeof NOTIFICATION_SERVICES)[number],
          "Tinkerbell",
          "Test notification from Tinkerbell",
        );
        reportHealth(healthName, "ok", "Test notification sent");
        return { ok: true as const };
      } catch (err) {
        reportHealth(healthName, "error", errorMessage(err));
        return { ok: false as const, error: errorMessage(err) };
      }
    }),

  notificationEventTypes: procedure.query(() => EVENT_TYPES),
});

export type AppRouter = typeof appRouter;
