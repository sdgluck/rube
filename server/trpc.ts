import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { getAllConfig, getConfig, setConfig, configSchema, type ConfigKey } from "./config.ts";
import { createPlexClient, SECTION_TYPE_MAP } from "./plex.ts";
import {
  syncCollections,
  getLocalCollections,
  getLocalCollection,
  updateCollection,
  updateCollectionLabels,
  deleteCollection,
} from "./collections.ts";
import { getJobs, getJobRuns, getJobRun, getActiveRuns, updateJob, startJob, cancelRun } from "./jobs.ts";
import { getRules, getRule, createRule, updateRule, deleteRule } from "./rules.ts";

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

  smartConfig: t.procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
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
  sessions: t.procedure.query(async () => {
    const client = getPlexClient();
    return client.getActiveSessions();
  }),

  recentlyAdded: t.procedure.query(async () => {
    const client = getPlexClient();
    return client.getRecentlyAdded(20);
  }),

  mostWatched: t.procedure.query(async () => {
    const client = getPlexClient();
    const history = await client.getWatchHistory({ limit: 1000 });
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
    const recentHistory = history.filter((item) => (item.viewedAt ?? 0) >= cutoff);

    const counts = new Map<
      string,
      { title: string; year?: number; type: string; grandparentTitle?: string; plays: number }
    >();
    for (const item of recentHistory) {
      const existing = counts.get(item.ratingKey);
      if (existing) {
        existing.plays++;
      } else {
        counts.set(item.ratingKey, {
          title: item.title,
          year: item.year,
          type: item.type,
          grandparentTitle: item.grandparentTitle,
          plays: 1,
        });
      }
    }

    return [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
  }),
});

const usersRouter = t.router({
  list: t.procedure.query(async () => {
    const client = getPlexClient();
    const identity = await client.getIdentity();
    const [sharings, allCollections, accounts, history] = await Promise.all([
      client.getSharings(identity.machineIdentifier),
      Promise.resolve(getLocalCollections()),
      client.getAccounts(),
      client.getWatchHistory({ limit: 500 }),
    ]);

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

const rulesRouter = t.router({
  list: t.procedure.query(() => getRules()),

  get: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => {
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

  delete: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    deleteRule(input.id);
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
      }),
    )
    .query(async ({ input }) => {
      const client = getPlexClient();
      let sections = await client.getSections();
      const configuredLibraries = getConfig("global_plex_libraries");
      if (configuredLibraries) {
        sections = sections.filter((s) => configuredLibraries.includes(s.title));
      }
      if (input.sectionId) {
        sections = sections.filter((s) => s.key === input.sectionId);
      }

      const typeNum = input.type ? SECTION_TYPE_MAP[input.type] : undefined;

      if (sections.length === 1) {
        const section = sections[0];
        const result = await client.getItems(section.key, {
          offset: input.offset,
          size: input.limit,
          title: input.search || undefined,
          type: typeNum,
        });
        return {
          items: result.items.map((item) => ({ ...item, sectionTitle: section.title })),
          total: result.total,
          offset: input.offset,
          limit: input.limit,
        };
      }

      // Multi-section: fetch from each and merge
      let allItems: Array<{
        ratingKey: string;
        title: string;
        year?: number;
        thumb?: string;
        type: string;
        addedAt?: number;
        sectionTitle: string;
      }> = [];
      let total = 0;
      for (const section of sections) {
        const result = await client.getItems(section.key, {
          offset: 0,
          size: input.offset + input.limit,
          title: input.search || undefined,
          type: typeNum,
        });
        allItems.push(...result.items.map((item) => ({ ...item, sectionTitle: section.title })));
        total += result.total;
      }

      // Sort by title and apply pagination
      allItems.sort((a, b) => a.title.localeCompare(b.title));
      const paged = allItems.slice(input.offset, input.offset + input.limit);

      return {
        items: paged,
        total,
        offset: input.offset,
        limit: input.limit,
      };
    }),

  get: t.procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
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
});

export const appRouter = t.router({
  config: configRouter,
  collections: collectionsRouter,
  media: mediaRouter,
  jobs: jobsRouter,
  rules: rulesRouter,
  users: usersRouter,
  stats: statsRouter,

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

  testRadarr: t.procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const instanceName = await testArrConnection(input.url, input.api_key);
      return { ok: true as const, instanceName };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }),

  testSonarr: t.procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const instanceName = await testArrConnection(input.url, input.api_key);
      return { ok: true as const, instanceName };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }),
});

export type AppRouter = typeof appRouter;
