import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createLlmClient } from "@tinkerbell/llm";
import { errorMessage, getConfig, REDACTED_SECRET, type ConfigKey } from "@tinkerbell/core";

// Test-connection endpoints accept secrets as input. If the form rendered the
// redaction sentinel (because the user didn't retype the stored value), swap
// it for the value already in the config so "Test" still works.
function unredact(value: string, storedKey: ConfigKey): string {
  if (value !== REDACTED_SECRET) return value;
  const stored = getConfig(storedKey);
  return typeof stored === "string" ? stored : "";
}

import { syncSections, getLocalSections } from "@tinkerbell/domain.sections";
import { reportHealth, testArrConnection } from "@tinkerbell/domain.health";
import { sendNotification, EVENT_TYPES, NOTIFICATION_SERVICES } from "@tinkerbell/domain.notifications";
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
import { navRouter } from "./nav.router.ts";
import { personalizationRouter } from "./personalization.router.ts";
import { preferencesRouter } from "./preferences.router.ts";

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
  nav: navRouter,
  personalization: personalizationRouter,
  preferences: preferencesRouter,

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

  // ─── Connection probes ──────────────────────────────────────────────────
  // Each `test*` procedure either returns the success payload or throws a
  // `TRPCError` (BAD_GATEWAY for upstream failures). UI consumers read the
  // success path from `mutateAsync`'s resolved value and the failure
  // message from the rejection's `.message`. This matches the contract
  // used by every other router in the app (SDG-18).

  testPlex: t.procedure
    .input(z.object({ plex_url: z.string(), plex_token: z.string() }))
    .mutation(async ({ input }) => {
      const plex_token = unredact(input.plex_token, "global_plex_token");
      try {
        const testUrl = new URL("/", input.plex_url);
        testUrl.searchParams.set("X-Plex-Token", plex_token);
        const pRes = await fetch(testUrl.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!pRes.ok) throw new Error(`Plex returned ${pRes.status} ${pRes.statusText}`);
        const data = await pRes.json();
        const name = data?.MediaContainer?.friendlyName || "Unknown";
        reportHealth("Plex", "ok", `Connected — ${name}`);
        return { serverName: name as string };
      } catch (err) {
        const message = errorMessage(err);
        reportHealth("Plex", "error", message);
        throw new TRPCError({ code: "BAD_GATEWAY", message });
      }
    }),

  testRadarr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    const api_key = unredact(input.api_key, "global_radarr_api_key");
    try {
      const instanceName = await testArrConnection(input.url, api_key);
      reportHealth("Radarr", "ok", `Connected — ${instanceName}`);
      return { instanceName };
    } catch (err) {
      const message = errorMessage(err);
      reportHealth("Radarr", "error", message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),

  testSonarr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    const api_key = unredact(input.api_key, "global_sonarr_api_key");
    try {
      const instanceName = await testArrConnection(input.url, api_key);
      reportHealth("Sonarr", "ok", `Connected — ${instanceName}`);
      return { instanceName };
    } catch (err) {
      const message = errorMessage(err);
      reportHealth("Sonarr", "error", message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),

  testSeerr: procedure.input(z.object({ url: z.string(), api_key: z.string() })).mutation(async ({ input }) => {
    const api_key = unredact(input.api_key, "global_seerr_api_key");
    try {
      const { testSeerrConnection } = await import("@tinkerbell/seerr");
      const data = await testSeerrConnection(input.url, api_key);
      reportHealth("Seerr", "ok", `Connected — ${data.total} total requests`);
      return { total: data.total };
    } catch (err) {
      const message = errorMessage(err);
      reportHealth("Seerr", "error", message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),

  testTmdb: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
    const api_key = unredact(input.api_key, "global_tmdb_api_key");
    try {
      const { testTmdbKey } = await import("@tinkerbell/tmdb");
      const data = await testTmdbKey(api_key);
      reportHealth("TMDb", "ok", `Test query OK — ${data.sample}`);
      return { sample: data.sample };
    } catch (err) {
      const message = errorMessage(err);
      reportHealth("TMDb", "error", message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),

  testOmdb: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
    const api_key = unredact(input.api_key, "global_omdb_api_key");
    try {
      const omdbUrl = new URL("https://www.omdbapi.com/");
      omdbUrl.searchParams.set("apikey", api_key);
      omdbUrl.searchParams.set("t", "Inception");
      const res = await fetch(omdbUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.Response === "False") throw new Error(data.Error || "Invalid API key");
      reportHealth("OMDB", "ok", `Test query OK — ${data.Title}`);
      return { title: data.Title as string };
    } catch (err) {
      const message = errorMessage(err);
      reportHealth("OMDB", "error", message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),

  testMdblist: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
    const api_key = unredact(input.api_key, "global_mdblist_api_key");
    try {
      const mdblistUrl = new URL("https://mdblist.com/api/user/");
      mdblistUrl.searchParams.set("apikey", api_key);
      const res = await fetch(mdblistUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const name = (data.name || data.username || "OK") as string;
      reportHealth("MDBList", "ok", `Connected — ${name}`);
      return { name };
    } catch (err) {
      const message = errorMessage(err);
      reportHealth("MDBList", "error", message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),

  testNotification: procedure
    .input(z.object({ service: z.enum(NOTIFICATION_SERVICES) }))
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
        return { sent: true as const };
      } catch (err) {
        const message = errorMessage(err);
        reportHealth(healthName, "error", message);
        throw new TRPCError({ code: "BAD_GATEWAY", message });
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
      let apiKey = input.apiKey;
      if (apiKey === REDACTED_SECRET) {
        apiKey = getConfig("global_llm")?.apiKey ?? getConfig("global_anthropic_api_key") ?? "";
      }
      const cfg = { ...input, apiKey };
      try {
        const client = createLlmClient(cfg);
        const res = await client.ping();
        reportHealth("LLM", "ok", `${res.provider}:${res.model} — test ok`);
        return { model: res.model, provider: res.provider };
      } catch (err) {
        const message = errorMessage(err);
        reportHealth("LLM", "error", message);
        throw new TRPCError({ code: "BAD_GATEWAY", message });
      }
    }),
});

export type AppRouter = typeof appRouter;

export { portalRouter, createPortalContext, type PortalRouter, type PortalContext } from "./portal.router.ts";
