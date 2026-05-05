import { z } from "zod";
import { createLlmClient } from "@tinkerbell/llm";
import { errorMessage } from "@tinkerbell/core";
import { syncSections, getLocalSections } from "#domains/sections.ts";
import { reportHealth, testArrConnection } from "#domains/health.ts";
import { sendNotification, EVENT_TYPES, NOTIFICATION_SERVICES } from "#domains/notifications.ts";
import { t, procedure, getPlexClient } from "./_base.ts";
import { configRouter } from "./config.router.ts";
import { collectionsRouter } from "./collections.router.ts";
import { mediaRouter } from "./media.router.ts";
import { jobsRouter } from "./jobs.router.ts";
import { rulesRouter } from "./rules.router.ts";
import { usersRouter } from "./users.router.ts";
import { statsRouter } from "./stats.router.ts";
import { overlaysRouter } from "./overlays.router.ts";
import { eventsRouter } from "./events.router.ts";
import { healthRouter } from "./health.router.ts";
import { stressTestRouter } from "./stress-test.router.ts";
import { previewRouter } from "./preview.router.ts";
import { searchRouter } from "./search.router.ts";
import { arrRouter } from "./arr.router.ts";
import { postersRouter } from "./posters.router.ts";
import { migrationRouter } from "./migration.router.ts";

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
  search: searchRouter,
  arr: arrRouter,
  posters: postersRouter,
  migration: migrationRouter,

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
      const { testSeerrConnection } = await import("@tinkerbell/seerr");
      const data = await testSeerrConnection(input.url, input.api_key);
      reportHealth("Seerr", "ok", `Connected — ${data.total} total requests`);
      return { ok: true as const, total: data.total };
    } catch (err) {
      reportHealth("Seerr", "error", errorMessage(err));
      return { ok: false as const, error: errorMessage(err) };
    }
  }),

  testTmdb: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
    try {
      const { testTmdbKey } = await import("@tinkerbell/tmdb");
      const data = await testTmdbKey(input.api_key);
      reportHealth("TMDb", "ok", `Test query OK — ${data.sample}`);
      return { ok: true as const, sample: data.sample };
    } catch (err) {
      reportHealth("TMDb", "error", errorMessage(err));
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

  testLlm: procedure
    .input(
      z.object({
        provider: z.enum(["anthropic", "openai", "gemini", "ollama", "openai-compatible"]),
        model: z.string().min(1),
        apiKey: z.string().optional(),
        baseUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const client = createLlmClient(input);
        const res = await client.ping();
        reportHealth("LLM", "ok", `${res.provider}:${res.model} — test ok`);
        return { ok: true as const, model: res.model, provider: res.provider };
      } catch (err) {
        reportHealth("LLM", "error", errorMessage(err));
        return { ok: false as const, error: errorMessage(err) };
      }
    }),
});

export type AppRouter = typeof appRouter;
