import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { getAllConfig, getConfig, setConfig, configSchema, type ConfigKey } from "./config.ts";
import { createPlexClient, type PlexClient } from "./plex.ts";
import { getLocalMediaItems } from "./media.ts";
import {
  syncCollections,
  getLocalCollections,
  getLocalCollection,
  getCollectionFilters,
  updateCollection,
  updateCollectionLabels,
  deleteCollection,
} from "./collections.ts";
import { getJobs, getJobRuns, getJobRun, getActiveRuns, updateJob, startJob, cancelRun } from "./jobs.ts";
import { getRules, getRule, createRule, updateRule, deleteRule } from "./rules.ts";
import {
  getOverlayConfigs,
  setOverlayConfig,
  removeOverlayConfig,
  clearOverlayConfigs,
  getOverlaidItemCount,
  resolveOverlayValue,
  compositeOverlays,
  OVERLAY_POSITIONS,
  OVERLAY_TYPES,
  type OverlayPosition,
  type OverlayType,
  type Badge,
} from "./overlays.ts";
import { extractImdbId, getOmdbRatings } from "./omdb.ts";
import { reportHealth, getHealthLatest, getHealthHistory } from "./health.ts";
import { getCachedRecentlyAdded, getCachedMostWatched } from "./stats.ts";
import { syncSections, getLocalSections } from "./sections.ts";
import { getEvents } from "./events.ts";
import { sendPushover, EVENT_TYPES } from "./notifications.ts";

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

async function testArrConnection(url: string, apiKey: string) {
  const testUrl = new URL("/api/v3/system/status", url);
  const res = await fetch(testUrl.toString(), {
    headers: { Accept: "application/json", "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.instanceName || data.appName || "Unknown";
}

const statsRouter = t.router({
  sessions: procedure.query(async () => {
    const client = getPlexClient();
    return client.getActiveSessions();
  }),
  recentlyAdded: procedure.query(() => getCachedRecentlyAdded()),
  mostWatched: procedure.query(() => getCachedMostWatched()),
});

const usersRouter = t.router({
  list: procedure.query(async () => {
    const client = getPlexClient();
    const identity = await client.getIdentity();
    const [sharings, allCollectionsResult, accounts, history] = await Promise.all([
      client.getSharings(identity.machineIdentifier),
      Promise.resolve(getLocalCollections()),
      client.getAccounts(),
      client.getWatchHistory({ limit: 500 }),
    ]);
    const allCollections = allCollectionsResult.items;

    // Build a map of User:{username} → collection count
    const userCollectionCounts = new Map<string, number>();
    for (const col of allCollections) {
      const labels: string[] = JSON.parse(col.labels);
      for (const label of labels) {
        if (label.startsWith("User:")) {
          userCollectionCounts.set(label, (userCollectionCounts.get(label) || 0) + 1);
        }
      }
    }

    // Build a map of accountID → most recent history item
    const lastWatchedByAccount = new Map<number, { title: string; viewedAt: number }>();
    for (const item of history) {
      if (!item.accountID || !item.viewedAt) continue;
      if (!lastWatchedByAccount.has(item.accountID)) {
        // History is sorted viewedAt:desc so first occurrence is most recent
        const title = item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title;
        lastWatchedByAccount.set(item.accountID, { title, viewedAt: item.viewedAt });
      }
    }

    // Build maps to match sharing users to local account IDs
    const accountById = new Map(accounts.map((a) => [Number(a.id), a]));
    const accountByName = new Map(accounts.map((a) => [a.name?.toLowerCase(), a]));

    return sharings.map((s) => {
      const userLabel = `User:${s.username}`;

      // Match sharing user to local account by ID first, then by name
      const account = accountById.get(s.userId) || accountByName.get(s.username.toLowerCase());
      const lastWatched = account ? lastWatchedByAccount.get(Number(account.id)) : undefined;

      return {
        id: s.userId,
        username: s.username,
        label: userLabel,
        collectionCount: userCollectionCounts.get(userLabel) || 0,
        lastWatched: lastWatched || null,
      };
    });
  }),
});

const testControllers = new Map<string, AbortController>();

const rulesRouter = t.router({
  list: procedure.query(() => getRules()),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const rule = getRule(input.id);
    if (!rule) throw new Error(`Rule ${input.id} not found`);
    return rule;
  }),

  create: t.procedure
    .input(z.object({ name: z.string(), type: z.string(), config: z.string() }))
    .mutation(({ input }) => {
      return createRule(input);
    }),

  update: t.procedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        config: z.string().optional(),
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
    media: Array<{ videoResolution?: string; videoCodec?: string; audioCodec?: string }>;
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
        position: z.enum(OVERLAY_POSITIONS as [string, ...string[]]),
        overlayType: z.enum(OVERLAY_TYPES as [string, ...string[]]),
      }),
    )
    .mutation(({ input }) => {
      setOverlayConfig(input.sectionId, input.position as OverlayPosition, input.overlayType as OverlayType);
      return { ok: true };
    }),

  removeConfig: t.procedure
    .input(z.object({ sectionId: z.string(), position: z.enum(OVERLAY_POSITIONS as [string, ...string[]]) }))
    .mutation(({ input }) => {
      removeOverlayConfig(input.sectionId, input.position as OverlayPosition);
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
          cfg.overlayType as OverlayType,
          {
            videoResolution: mediaInfo.videoResolution,
            videoCodec: mediaInfo.videoCodec,
            audioCodec: mediaInfo.audioCodec,
            contentRating: detail.contentRating,
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
          cfg.overlayType as OverlayType,
          {
            videoResolution: mediaInfo.videoResolution,
            videoCodec: mediaInfo.videoCodec,
            audioCodec: mediaInfo.audioCodec,
            contentRating: detail.contentRating,
          },
          ratings,
        );
        if (value) {
          badges.push({
            position: cfg.position as Badge["position"],
            type: cfg.overlayType as OverlayType,
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

const HEALTH_SERVICES = [
  {
    service: "Plex",
    configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!(c.global_plex_url && c.global_plex_token),
  },
  { service: "Plex.tv", configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!c.global_plex_token },
  { service: "Claude AI", configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!c.global_anthropic_api_key },
  { service: "OMDB", configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!c.global_omdb_api_key },
  { service: "IMDb", configuredFn: () => true },
  {
    service: "Radarr",
    configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!(c.global_radarr_url && c.global_radarr_api_key),
  },
  {
    service: "Sonarr",
    configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!(c.global_sonarr_url && c.global_sonarr_api_key),
  },
  { service: "MDBList", configuredFn: (c: Partial<z.infer<typeof configSchema>>) => !!c.global_mdblist_api_key },
  {
    service: "Pushover",
    configuredFn: (c: Partial<z.infer<typeof configSchema>>) =>
      !!(c.global_pushover_api_key && c.global_pushover_user_key),
  },
] as const;

async function checkServiceHealth(service: string): Promise<void> {
  const cfg = getAllConfig();

  switch (service) {
    case "Plex": {
      if (!cfg.global_plex_url || !cfg.global_plex_token) throw new Error("Not configured");
      const client = createPlexClient({ url: cfg.global_plex_url, token: cfg.global_plex_token });
      await client.getIdentity();
      break;
    }
    case "Plex.tv": {
      if (!cfg.global_plex_token) throw new Error("Not configured");
      const reqUrl = new URL("/api/v2/user", "https://plex.tv");
      reqUrl.searchParams.set("X-Plex-Token", cfg.global_plex_token);
      const res = await fetch(reqUrl.toString(), {
        headers: { Accept: "application/json", "X-Plex-Client-Identifier": "tinkerbell" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      reportHealth("Plex.tv", "ok", `GET /api/v2/user → ${res.status}`);
      break;
    }
    case "Claude AI": {
      if (!cfg.global_anthropic_api_key) throw new Error("Not configured");
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey: cfg.global_anthropic_api_key });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      reportHealth("Claude AI", "ok", `${response.model} — health check OK`);
      break;
    }
    case "OMDB": {
      if (!cfg.global_omdb_api_key) throw new Error("Not configured");
      const res = await fetch(`https://www.omdbapi.com/?apikey=${cfg.global_omdb_api_key}&t=test`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      reportHealth("OMDB", "ok", `GET / → ${res.status}`);
      break;
    }
    case "IMDb": {
      const res = await fetch("https://www.imdb.com/chart/top/", {
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      reportHealth("IMDb", "ok", `GET /chart/top/ → ${res.status}`);
      break;
    }
    case "Radarr": {
      if (!cfg.global_radarr_url || !cfg.global_radarr_api_key) throw new Error("Not configured");
      const name = await testArrConnection(cfg.global_radarr_url, cfg.global_radarr_api_key);
      reportHealth("Radarr", "ok", `Connected — ${name}`);
      break;
    }
    case "Sonarr": {
      if (!cfg.global_sonarr_url || !cfg.global_sonarr_api_key) throw new Error("Not configured");
      const name = await testArrConnection(cfg.global_sonarr_url, cfg.global_sonarr_api_key);
      reportHealth("Sonarr", "ok", `Connected — ${name}`);
      break;
    }
    case "MDBList": {
      if (!cfg.global_mdblist_api_key) throw new Error("Not configured");
      const res = await fetch(`https://mdblist.com/api/user/?apikey=${cfg.global_mdblist_api_key}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      reportHealth("MDBList", "ok", `Connected — ${data.name || data.username || "OK"}`);
      break;
    }
    case "Pushover": {
      if (!cfg.global_pushover_api_key || !cfg.global_pushover_user_key) throw new Error("Not configured");
      const res = await fetch("https://api.pushover.net/1/users/validate.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cfg.global_pushover_api_key, user: cfg.global_pushover_user_key }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.status !== 1) throw new Error(data.errors?.join(", ") || "Invalid credentials");
      reportHealth("Pushover", "ok", "Credentials valid");
      break;
    }
    default:
      throw new Error(`Unknown service: ${service}`);
  }
}

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
      reportHealth(input.service, "error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
    }
  }),
});

const eventsRouter = t.router({
  list: t.procedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(({ input }) => getEvents(input)),
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
        reportHealth("Plex", "error", (err as Error).message);
        return { ok: false as const, error: (err as Error).message };
      }
    }),

  testRadarr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const instanceName = await testArrConnection(input.url, input.api_key);
      reportHealth("Radarr", "ok", `Connected — ${instanceName}`);
      return { ok: true as const, instanceName };
    } catch (err) {
      reportHealth("Radarr", "error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
    }
  }),

  testSonarr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const instanceName = await testArrConnection(input.url, input.api_key);
      reportHealth("Sonarr", "ok", `Connected — ${instanceName}`);
      return { ok: true as const, instanceName };
    } catch (err) {
      reportHealth("Sonarr", "error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
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
      reportHealth("OMDB", "error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
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
      reportHealth("MDBList", "error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
    }
  }),

  testPushover: procedure.mutation(async () => {
    try {
      await sendPushover("Tinkerbell", "Test notification from Tinkerbell");
      reportHealth("Pushover", "ok", "Test notification sent");
      return { ok: true as const };
    } catch (err) {
      reportHealth("Pushover", "error", (err as Error).message);
      return { ok: false as const, error: (err as Error).message };
    }
  }),

  pushoverEventTypes: procedure.query(() => EVENT_TYPES),
});

export type AppRouter = typeof appRouter;
