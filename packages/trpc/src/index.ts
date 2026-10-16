import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createLlmClient, listModels } from "@tinkerbell/llm";
import { errorMessage, REDACTED_SECRET, type ConfigKey } from "@tinkerbell/core";
import { testArrConnection } from "@tinkerbell/domain.health";
import { testMqtt } from "@tinkerbell/mqtt";
import { EVENT_TYPES, NOTIFICATION_SERVICES } from "@tinkerbell/domain.notifications";
import { t, procedure, mapNotConfiguredClient } from "./_base.ts";
import { createAdminAuthRouter } from "./admin-auth.router.ts";
import { createPortalRouter } from "./portal.router.ts";
import { createConfigRouter } from "./config.router.ts";
import { createBandwidthRouter } from "./bandwidth.router.ts";
import { createCollectionsRouter } from "./collections.router.ts";
import { createMediaRouter } from "./media.router.ts";
import { createJobsRouter } from "./jobs.router.ts";
import { createRulesRouter } from "./rules.router.ts";
import { createUsersRouter } from "./users.router.ts";
import { createStatsRouter } from "./stats.router.ts";
import { createOverlaysRouter } from "./overlays.router.ts";
import { createEventsRouter } from "./events.router.ts";
import { createHealthRouter } from "./health.router.ts";
import { createStressTestRouter } from "./stress-test.router.ts";
import { createPreviewRouter } from "./preview.router.ts";
import { createSearchRouter } from "./search.router.ts";
import { createNotificationsRouter } from "./notifications.router.ts";
import { createChangesRouter } from "./changes.router.ts";
import { createHistoryRouter } from "./history.router.ts";
import { createBackupsRouter } from "./backups.router.ts";
import { createAiUsageRouter } from "./ai-usage.router.ts";
import { createApiKeysRouter } from "./api-keys.router.ts";
import { createArrRouter } from "./arr.router.ts";
import { createDownloadClientsRouter } from "./download-clients.router.ts";
import { createDiscoverRouter } from "./discover.router.ts";
import { createPostersRouter } from "./posters.router.ts";
import { createPrerollsRouter } from "./prerolls.router.ts";
import { createMigrationRouter } from "./migration.router.ts";
import { createRecommendationsRouter } from "./recommendations.router.ts";
import { createRegistryRouter } from "./registry.router.ts";
import { createOnboardingRouter } from "./onboarding.router.ts";
import { createNavRouter } from "./nav.router.ts";
import { createProblemsRouter } from "./problems.router.ts";
import { createViewsRouter } from "./views.router.ts";
import { createCleanupRouter } from "./cleanup.router.ts";
import { createMetadataRouter } from "./metadata.router.ts";
import { createDigestRouter } from "./digest.router.ts";
import { createWatchlistRouter } from "./watchlist.router.ts";
import { createPersonalizationRouter } from "./personalization.router.ts";
import { createAiPreviewRouter } from "./ai-preview.router.ts";

const appRouterFor = (deps: TrpcDeps) => {
  const { getConfig } = deps.config;
  const { syncSections, getLocalSections } = deps.sections;
  const { reportHealth } = deps.health;
  const { track } = deps.aiUsage;
  const { sendNotification } = deps.notifications;
  const getPlexClient = mapNotConfiguredClient(deps.clients);

  // Test-connection endpoints accept secrets as input. If the form rendered the
  // redaction sentinel (because the user didn't retype the stored value), swap
  // it for the value already in the config so "Test" still works.
  function unredact(value: string, storedKey: ConfigKey): string {
    if (value !== REDACTED_SECRET) return value;
    const stored = getConfig(storedKey);
    return typeof stored === "string" ? stored : "";
  }

  return t.router({
    auth: createAdminAuthRouter(deps).adminAuthRouter,
    config: createConfigRouter(deps),
    collections: createCollectionsRouter(deps),
    media: createMediaRouter(deps),
    jobs: createJobsRouter(deps),
    rules: createRulesRouter(deps),
    users: createUsersRouter(deps),
    stats: createStatsRouter(deps),
    overlays: createOverlaysRouter(deps),
    cleanup: createCleanupRouter(deps),
    metadata: createMetadataRouter(deps),
    digest: createDigestRouter(deps),
    watchlist: createWatchlistRouter(deps),
    events: createEventsRouter(deps),
    health: createHealthRouter(deps),
    bandwidth: createBandwidthRouter(deps),
    stressTest: createStressTestRouter(deps),
    preview: createPreviewRouter(deps),
    search: createSearchRouter(deps),
    arr: createArrRouter(deps),
    discover: createDiscoverRouter(deps),
    downloadClients: createDownloadClientsRouter(deps),
    posters: createPostersRouter(deps),
    prerolls: createPrerollsRouter(deps),
    migration: createMigrationRouter(deps),
    registry: createRegistryRouter(deps),
    onboarding: createOnboardingRouter(deps),
    nav: createNavRouter(deps),
    problems: createProblemsRouter(deps),
    views: createViewsRouter(deps),
    personalization: createPersonalizationRouter(deps),
    aiPreview: createAiPreviewRouter(deps),
    notifications: createNotificationsRouter(deps),
    changes: createChangesRouter(deps),
    history: createHistoryRouter(deps),
    backups: createBackupsRouter(deps),
    aiUsage: createAiUsageRouter(deps),
    recommendations: createRecommendationsRouter(deps),
    apiKeys: createApiKeysRouter(deps),

    /**
     * The server's machine identifier, which is what an `app.plex.tv` deep link
     * needs to name the server an item lives on.
     *
     * Its own procedure rather than folded into a page's payload: it never
     * changes for the life of a server, so the client caches it forever and
     * every "Open in Plex" link on every page is free after the first.
     */
    plexIdentity: procedure.query(async () => {
      const { machineIdentifier } = await getPlexClient().getIdentity();
      return { machineIdentifier };
    }),

    plexSections: procedure.query(async () => {
      const cached = getLocalSections();
      if (cached.length > 0) return cached;

      // Cache empty (first run) — fetch live and populate
      const client = getPlexClient();
      const sections = await client.getSections();
      await syncSections(client);
      return sections.map((s) => ({ key: s.key, title: s.title, type: s.type }));
    }),

    /**
     * Item count per section, keyed by title because that is what a rule's
     * `sections` list holds.
     *
     * One `totalSize`-only request per section, so it is cheap enough for the
     * rule wizard to ask on open — it needs a denominator to estimate how many
     * collections a grouped rule would build. A section Plex won't count is
     * omitted rather than fatal; the estimate degrades to "unknown", which is
     * the honest answer.
     */
    plexSectionItemCounts: procedure.query(async () => {
      const client = getPlexClient();
      const sections = getLocalSections();
      const counts: Record<string, number> = {};
      await Promise.all(
        sections.map(async (section) => {
          try {
            counts[section.title] = await client.getSectionItemCount(section.key);
          } catch {
            // Left out deliberately — see above.
          }
        }),
      );
      return counts;
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

    testPlex: procedure
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

    testMqtt: procedure
      .input(z.object({ url: z.string(), username: z.string().optional(), password: z.string().optional() }))
      .mutation(async ({ input }) => {
        // A nested secret, so `unredact` (which reads a top-level key) can't swap it back.
        const password =
          input.password === REDACTED_SECRET ? getConfig("global_mqtt")?.password : input.password || undefined;
        try {
          const message = await testMqtt({ url: input.url.trim(), username: input.username || undefined, password });
          reportHealth("MQTT", "ok", message);
          return { message };
        } catch (err) {
          const message = errorMessage(err);
          reportHealth("MQTT", "error", message);
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

    testTrakt: procedure.input(z.object({ api_key: z.string() })).mutation(async ({ input }) => {
      const api_key = unredact(input.api_key, "global_trakt_client_id");
      try {
        // A public endpoint, so this proves the client id without needing the
        // OAuth flow the key alone can't complete.
        const res = await fetch("https://api.trakt.tv/lists/trending?limit=1", {
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/json",
            "trakt-api-version": "2",
            "trakt-api-key": api_key,
          },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        reportHealth("Trakt", "ok", "Connected");
        return { name: "Trakt" };
      } catch (err) {
        const message = errorMessage(err);
        reportHealth("Trakt", "error", message);
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
          const client = track(createLlmClient(cfg), { feature: "test-connection" });
          const res = await client.ping();
          reportHealth("LLM", "ok", `${res.provider}:${res.model} — test ok`);
          return { model: res.model, provider: res.provider };
        } catch (err) {
          const message = errorMessage(err);
          reportHealth("LLM", "error", message);
          throw new TRPCError({ code: "BAD_GATEWAY", message });
        }
      }),

    /**
     * The models the server actually has, for the Settings dropdown. Null
     * where the curated presets are the better list (hosted providers) or the
     * server can't be reached yet — the form falls back to presets either way,
     * so a half-typed URL is not an error to show.
     */
    llmModels: procedure
      .input(
        z.object({
          provider: z.enum(["anthropic", "openai", "gemini", "ollama", "openai-compatible"]),
          baseUrl: z.string().url().optional(),
        }),
      )
      .query(async ({ input }) => {
        try {
          return await listModels(input);
        } catch {
          return null;
        }
      }),
  });
};

/**
 * The whole tRPC surface, built for one container.
 *
 * A factory rather than a set of module constants because every router below
 * it is one: a router closes over the domains it calls, and those come from
 * the container. Still built once at boot, exactly like the constants it
 * replaces — per-request state travels in `ctx`, as it always did.
 *
 * The two context builders come back from here too. They read sessions and
 * decide who the caller is, which is a database question, so they are no more
 * a module-level function than the routers are.
 */
export function createTrpc(deps: TrpcDeps) {
  const admin = createAdminAuthRouter(deps);
  const portal = createPortalRouter(deps);
  const appRouter = appRouterFor(deps);
  return {
    appRouter,
    /**
     * In-process calls through the full middleware chain, for the agent API.
     * It goes through the procedures rather than the domains so that a tool
     * answers with exactly what the admin UI would show, and so that the
     * read-only guard in `_base.ts` applies to it.
     */
    createCaller: t.createCallerFactory(appRouter),
    portalRouter: portal.portalRouter,
    createAdminContext: admin.createAdminContext,
    createPortalContext: portal.createPortalContext,
  };
}

export type Trpc = ReturnType<typeof createTrpc>;
export type AppRouter = Trpc["appRouter"];
export type PortalRouter = Trpc["portalRouter"];

export { type PortalContext } from "./portal.router.ts";
export { type AdminContext } from "./_base.ts";
