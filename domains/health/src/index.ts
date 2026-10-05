import { eq, desc, and, gte, sql } from "drizzle-orm";
import { errorMessage, type ConfigStore, type ArrInstances } from "@tinkerbell/core";
import { events, healthChecks, type Db } from "@tinkerbell/db";

import { configSchema, WEEK_MS } from "@tinkerbell/core";
import { createPlexClient } from "@tinkerbell/plex";
import { createLlmClient } from "@tinkerbell/llm";
import type { AiUsage } from "@tinkerbell/domain.ai-usage";
import { z } from "zod";
import { type EventBus } from "@tinkerbell/ports";
import { type Prerolls } from "@tinkerbell/domain.prerolls";
import { token } from "@tinkerbell/container";

type ConfigMap = Partial<z.infer<typeof configSchema>>;

export const HEALTH_SERVICES: Array<{ service: string; configuredFn: (c: ConfigMap) => boolean }> = [
  { service: "Plex", configuredFn: (c) => !!(c.global_plex_url && c.global_plex_token) },
  { service: "Plex.tv", configuredFn: (c) => !!c.global_plex_token },
  { service: "LLM", configuredFn: (c) => !!c.global_llm || !!c.global_anthropic_api_key },
  { service: "OMDB", configuredFn: (c) => !!c.global_omdb_api_key },
  { service: "IMDb", configuredFn: () => true },
  { service: "Radarr", configuredFn: (c) => !!(c.global_radarr_url && c.global_radarr_api_key) },
  { service: "Sonarr", configuredFn: (c) => !!(c.global_sonarr_url && c.global_sonarr_api_key) },
  { service: "Seerr", configuredFn: (c) => !!(c.global_seerr_url && c.global_seerr_api_key) },
  { service: "MDBList", configuredFn: (c) => !!c.global_mdblist_api_key },
  { service: "Trakt", configuredFn: (c) => !!c.global_trakt_client_id },
  { service: "TMDb", configuredFn: (c) => !!c.global_tmdb_api_key },
  { service: "Pushover", configuredFn: (c) => !!(c.global_pushover_api_key && c.global_pushover_user_key) },
  { service: "Discord", configuredFn: (c) => !!c.global_discord_webhook_url },
  { service: "Gotify", configuredFn: (c) => !!(c.global_gotify_url && c.global_gotify_token) },
  { service: "LunaSea", configuredFn: (c) => !!c.global_lunasea_webhook_url },
  { service: "Pushbullet", configuredFn: (c) => !!c.global_pushbullet_token },
  { service: "Slack", configuredFn: (c) => !!c.global_slack_webhook_url },
  { service: "Telegram", configuredFn: (c) => !!(c.global_telegram_bot_token && c.global_telegram_chat_id) },
  { service: "Webhook", configuredFn: (c) => !!c.global_webhook_url },
  // Only checked once the admin has actually configured prerolls — before
  // that, a missing ffmpeg isn't a fault, it's an unused feature.
  { service: "Prerolls", configuredFn: (c) => !!c.prerolls_plex_path },
];

type ArrInstanceLike = { id: string; service: "radarr" | "sonarr"; name: string; isDefault?: boolean };

/**
 * The health-service name for one extra \*Arr instance.
 *
 * Derived from the display name — `Radarr (4K)` — because this string is what
 * the notification target picker offers and what the Health page shows, and
 * "Radarr (4K)" is what somebody routing "tell me when the 4K one dies" is
 * looking for. Two instances sharing a name would otherwise collapse onto one
 * health row, so a repeat is disambiguated by its id.
 *
 * The cost of a display-derived key is that renaming an instance changes it, and
 * everything filed under the old string — check history, a mute, an entry in a
 * `global_*_health_targets` allow-list — would be orphaned. `renameArrHealthServices`
 * carries those over, and the config writer calls it. Stable ids exist for
 * exactly this reason (see `global_arr_instances[].id`); the compromise here is
 * that the *stored* key stays legible while the *rename* is handled.
 */
function arrHealthServiceName(instance: ArrInstanceLike, all: readonly ArrInstanceLike[]): string {
  const base = instance.service === "radarr" ? "Radarr" : "Sonarr";
  const sameName = all.filter((i) => !i.isDefault && i.service === instance.service && i.name === instance.name);
  const suffix = sameName.length > 1 ? ` #${instance.id}` : "";
  return `${base} (${instance.name})${suffix}`;
}

/** Health-service name per extra instance id, for a given set of instances. */
export function arrHealthServiceNames(instances: readonly ArrInstanceLike[]): Map<string, string> {
  const extra = instances.filter((i) => !i.isDefault);
  return new Map(extra.map((i) => [i.id, arrHealthServiceName(i, extra)]));
}

/** Every per-service allow-list a health notification is routed through. */
const HEALTH_TARGET_KEYS = [
  "global_discord_health_targets",
  "global_gotify_health_targets",
  "global_lunasea_health_targets",
  "global_pushbullet_health_targets",
  "global_pushover_health_targets",
  "global_slack_health_targets",
  "global_smtp_health_targets",
  "global_telegram_health_targets",
  "global_webhook_health_targets",
] as const;

export async function testArrConnection(url: string, apiKey: string) {
  const testUrl = new URL("/api/v3/system/status", url);
  const res = await fetch(testUrl.toString(), {
    headers: { Accept: "application/json", "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.instanceName || data.appName || "Unknown";
}

/**
 * Consecutive error checks, most recent first.
 *
 * Reads a bounded window rather than a service's whole history: the answer is
 * only ever compared against a threshold capped at 20, so anything past that
 * is the same answer.
 */
/**
 * The failing streak this service is currently in, and when it started.
 *
 * Not capped at the threshold. It used to be, which broke the pairing the
 * announce logic promises: lowering the threshold from 5 to 2 during a four-check
 * outage read the streak as 2, so `priorFailures + 1 === threshold` never matched
 * and no failure was announced — while the eventual recovery passed
 * `priorFailures >= threshold` and *was* announced. Silent when it breaks and
 * chatty when it returns is the exact outcome the docblock below calls the worst
 * of both.
 *
 * Bounded by a generous row cap rather than by the threshold: a check every few
 * minutes for a week is thousands of rows, and the prune keeps seven days.
 */
const STREAK_SCAN_LIMIT = 5_000;

export interface HealthDeps {
  db: Db;
  config: ConfigStore;
  emitEvent: EventBus;
  arr: ArrInstances;
  prerolls: Prerolls;
  aiUsage: AiUsage;
}
export function createHealth(deps: HealthDeps) {
  const { db, emitEvent } = deps;
  const { getConfig, setConfig, getAllConfig, getLlmConfig } = deps.config;
  const { arrInstances } = deps.arr;
  const { getEnvironment, getPlexPrerollStatus } = deps.prerolls;

  /**
   * The static list plus one entry per extra \*Arr instance.
   *
   * Instances are configuration, not code, so they cannot live in the array
   * above — but a second Radarr that nobody is watching is exactly as useful as
   * a first one that nobody is watching.
   */
  function healthServices(): Array<{ service: string; configuredFn: (c: ConfigMap) => boolean }> {
    const instances = arrInstances();
    const names = arrHealthServiceNames(instances);
    const extra = instances
      .filter((i) => !i.isDefault)
      .map((i) => ({
        service: names.get(i.id) ?? `${i.service === "radarr" ? "Radarr" : "Sonarr"} (${i.name})`,
        // Already resolved from config to exist at all, so it is configured by
        // construction — the check itself is what reports whether it answers.
        configuredFn: () => true,
      }));
    return [...HEALTH_SERVICES, ...extra];
  }

  /** The instance behind a derived `Radarr (4K)` health name, if it is one. */
  function instanceForHealthService(service: string): { url: string; apiKey: string } | null {
    const instances = arrInstances();
    const names = arrHealthServiceNames(instances);
    for (const instance of instances) {
      if (instance.isDefault) continue;
      if (names.get(instance.id) === service) return { url: instance.url, apiKey: instance.apiKey };
    }
    return null;
  }

  /**
   * Carry an extra instance's health identity across a rename.
   *
   * Called with the instance list as it was *before* a config write. For every id
   * whose derived health name changed, the check history, any mute and every
   * notification target allow-list entry move with it — otherwise renaming "4K" to
   * "UHD" silently detached the instance's whole history and stopped a routing rule
   * that named it from matching anything, which is the sort of failure nobody
   * connects to a rename weeks later.
   */
  function renameArrHealthServices(before: readonly ArrInstanceLike[]): void {
    const previous = arrHealthServiceNames(before);
    const current = arrHealthServiceNames(arrInstances());
    for (const [id, from] of previous) {
      const to = current.get(id);
      if (!to || to === from) continue;

      db.update(healthChecks).set({ service: to }).where(eq(healthChecks.service, from)).run();

      const mutes = getConfig("health_mutes");
      if (mutes && from in mutes) {
        const next = { ...mutes, [to]: mutes[from] };
        delete next[from];
        setConfig("health_mutes", next);
      }

      for (const key of HEALTH_TARGET_KEYS) {
        const targets = getConfig(key);
        if (!targets?.includes(from)) continue;
        setConfig(key, [...new Set(targets.map((t) => (t === from ? to : t)))]);
      }
    }
  }

  async function checkServiceHealth(service: string): Promise<void> {
    const cfg = getAllConfig();

    // An extra instance carries its own credentials and answers the same
    // endpoint as the default one, so it needs no case of its own.
    const instance = instanceForHealthService(service);
    if (instance) {
      const name = await testArrConnection(instance.url, instance.apiKey);
      reportHealth(service, "ok", `Connected — ${name}`);
      return;
    }

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
      case "LLM": {
        const llm = getLlmConfig();
        if (!llm) throw new Error("Not configured");
        const client = deps.aiUsage.track(createLlmClient(llm), { feature: "health-check" });
        const res = await client.ping();
        reportHealth("LLM", "ok", `${res.provider}:${res.model} — health check OK`);
        break;
      }
      case "OMDB": {
        if (!cfg.global_omdb_api_key) throw new Error("Not configured");
        const omdbUrl = new URL("https://www.omdbapi.com/");
        omdbUrl.searchParams.set("apikey", cfg.global_omdb_api_key);
        omdbUrl.searchParams.set("t", "test");
        const res = await fetch(omdbUrl, {
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
      case "Seerr": {
        if (!cfg.global_seerr_url || !cfg.global_seerr_api_key) throw new Error("Not configured");
        const { testSeerrConnection } = await import("@tinkerbell/seerr");
        const data = await testSeerrConnection(cfg.global_seerr_url, cfg.global_seerr_api_key);
        reportHealth("Seerr", "ok", `Connected — ${data.total} total requests`);
        break;
      }
      case "TMDb": {
        if (!cfg.global_tmdb_api_key) throw new Error("Not configured");
        const { testTmdbKey } = await import("@tinkerbell/tmdb");
        const data = await testTmdbKey(cfg.global_tmdb_api_key);
        reportHealth("TMDb", "ok", `Test query OK — ${data.sample}`);
        break;
      }
      case "MDBList": {
        if (!cfg.global_mdblist_api_key) throw new Error("Not configured");
        const mdblistUrl = new URL("https://mdblist.com/api/user/");
        mdblistUrl.searchParams.set("apikey", cfg.global_mdblist_api_key);
        const res = await fetch(mdblistUrl, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        reportHealth("MDBList", "ok", `Connected — ${data.name || data.username || "OK"}`);
        break;
      }
      case "Trakt": {
        if (!cfg.global_trakt_client_id) throw new Error("Not configured");
        // Any public endpoint proves the key: this one is cheap and stable.
        const res = await fetch("https://api.trakt.tv/lists/trending?limit=1", {
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/json",
            "trakt-api-version": "2",
            "trakt-api-key": cfg.global_trakt_client_id,
          },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        reportHealth("Trakt", "ok", "Connected");
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
      case "Discord": {
        if (!cfg.global_discord_webhook_url) throw new Error("Not configured");
        const res = await fetch(cfg.global_discord_webhook_url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        reportHealth("Discord", "ok", `Webhook valid — #${data.name || "unknown"}`);
        break;
      }
      case "Gotify": {
        if (!cfg.global_gotify_url || !cfg.global_gotify_token) throw new Error("Not configured");
        const versionUrl = new URL("/version", cfg.global_gotify_url);
        const res = await fetch(versionUrl.toString(), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        reportHealth("Gotify", "ok", `Connected — v${data.version || "?"}`);
        break;
      }
      case "LunaSea": {
        if (!cfg.global_lunasea_webhook_url) throw new Error("Not configured");
        reportHealth("LunaSea", "ok", "Webhook URL configured");
        break;
      }
      case "Pushbullet": {
        if (!cfg.global_pushbullet_token) throw new Error("Not configured");
        const res = await fetch("https://api.pushbullet.com/v2/users/me", {
          headers: { "Access-Token": cfg.global_pushbullet_token },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        reportHealth("Pushbullet", "ok", `Connected — ${data.name || data.email || "OK"}`);
        break;
      }
      case "Slack": {
        if (!cfg.global_slack_webhook_url) throw new Error("Not configured");
        reportHealth("Slack", "ok", "Webhook URL configured");
        break;
      }
      case "Telegram": {
        if (!cfg.global_telegram_bot_token || !cfg.global_telegram_chat_id) throw new Error("Not configured");
        const res = await fetch(`https://api.telegram.org/bot${cfg.global_telegram_bot_token}/getMe`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || "Invalid bot token");
        reportHealth("Telegram", "ok", `Bot valid — @${data.result?.username || "?"}`);
        break;
      }
      case "Webhook": {
        if (!cfg.global_webhook_url) throw new Error("Not configured");
        reportHealth("Webhook", "ok", "Webhook URL configured");
        break;
      }
      case "Prerolls": {
        // Three separate ways this feature silently stops working, none of
        // which surface until a movie starts: ffmpeg vanishing, the volume
        // going read-only, and Plex's preference drifting from what we set.
        const env = await getEnvironment();
        if (!env.ffmpeg) throw new Error("ffmpeg is not installed or not on PATH");
        if (!env.dirWritable) throw new Error(`Can't write to ${env.dir}`);
        const sync = await getPlexPrerollStatus();
        if (!sync.inSync) {
          throw new Error(`Plex's pre-roll setting doesn't match — expected "${sync.expected}", got "${sync.actual}"`);
        }
        reportHealth("Prerolls", "ok", `ffmpeg ${env.ffmpeg}; Plex in sync`);
        break;
      }
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  /** Check all configured services, reporting health for each. Returns a summary string. */
  async function checkAllConfiguredServices(signal?: AbortSignal): Promise<string> {
    const cfg = getAllConfig();
    const configured = healthServices().filter((svc) => svc.configuredFn(cfg));
    const results: string[] = [];

    for (const svc of configured) {
      // Checked between services rather than threaded into each request: every
      // individual check already carries its own 10s timeout, so the only wait
      // worth interrupting is the queue of remaining services.
      if (signal?.aborted) {
        results.push(`cancelled before ${configured.length - results.length} remaining service(s)`);
        break;
      }
      try {
        await checkServiceHealth(svc.service);
        results.push(`${svc.service}: ok`);
      } catch (err) {
        reportHealth(svc.service, "error", errorMessage(err));
        results.push(`${svc.service}: error — ${errorMessage(err)}`);
      }
    }

    return `Checked ${configured.length} service(s): ${results.join("; ")}`;
  }

  function failureStreak(service: string): { failures: number; since: number | null } {
    const rows = db
      .select({ status: healthChecks.status, timestamp: healthChecks.timestamp })
      .from(healthChecks)
      .where(eq(healthChecks.service, service))
      .orderBy(desc(healthChecks.timestamp))
      .limit(STREAK_SCAN_LIMIT)
      .all();
    let failures = 0;
    let since: number | null = null;
    for (const row of rows) {
      if (row.status !== "error") break;
      failures++;
      since = row.timestamp;
    }
    return { failures, since };
  }

  /**
   * Has this outage already been announced?
   *
   * Read from the events table rather than tracked in memory, for the same reason
   * the streak is read from the checks table: the process is restarted by every
   * upgrade, which is exactly when a server is most likely to be unreachable. It is
   * also what lets the threshold change mid-outage without the announce and the
   * recovery disagreeing about what happened.
   */
  function outageAnnounced(service: string, since: number): boolean {
    const row = db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.type, "health.failed"),
          gte(events.timestamp, since),
          sql`json_extract(${events.metadata}, '$.service') = ${service}`,
        ),
      )
      .limit(1)
      .get();
    return !!row;
  }

  /**
   * Record a check, and announce the transitions worth announcing.
   *
   * With a threshold of 1 — the default, and what every existing install has —
   * this is exactly the old behaviour: announce on the ok→error edge, announce
   * the recovery on error→ok.
   *
   * Above 1, the edge stops being the trigger and the count becomes it. Two
   * things follow, and getting either wrong is worse than not having the
   * feature. The failure is announced on the run that *reaches* the threshold
   * and not after, so a service that stays down produces one message rather
   * than one an hour. And the recovery is announced only if the outage it ends
   * was itself announced — otherwise raising the threshold would turn a
   * flapping service from noisy in both directions into silent when it breaks
   * and chatty when it returns, which is the worst of both.
   *
   * The count comes from the table, never from memory: a restart mid-outage
   * must not reset the streak and re-announce, and the process running this is
   * restarted by every upgrade.
   */
  function reportHealth(service: string, status: "ok" | "error", message: string): void {
    const threshold = getConfig("health_failure_threshold") ?? 1;

    // Read before the insert: this is the state the streak was in when the check
    // ran, which is what decides whether anything is announced.
    const prior = failureStreak(service);
    const now = Date.now();
    const outageStart = prior.since ?? now;
    const announced = prior.failures > 0 && outageAnnounced(service, outageStart);

    db.insert(healthChecks).values({ service, status, message, timestamp: now }).run();

    if (status === "error") {
      // Crossed the threshold, and this outage hasn't been announced yet. Both
      // halves are needed: without the first a long outage is one message rather
      // than one an hour, and without the second changing the threshold mid-outage
      // either re-announces it or silences it for good.
      //
      // A service with no history at all is announced on its first failing check
      // rather than swallowed. It used to return early on a missing previous row,
      // so a newly added *Arr instance — or one whose checks had been off for a
      // week and pruned — lost its first failure entirely.
      if (prior.failures + 1 >= threshold && !announced) {
        emitEvent("health.failed", `${service}: ${message}`, { service });
        // Plex going away stops every job, every rule and the portal, so it gets
        // its own event type on top of the generic one — a user who routes
        // `health.failed` to a quiet channel usually wants this one somewhere
        // they'll actually see it. Both fire; the per-service event selection is
        // what decides whether either is delivered.
        if (service === "Plex") {
          emitEvent("plex.unreachable", `Plex is unreachable: ${message}`, { service });
        }
      }
    } else if (announced) {
      // Only an outage somebody was told about gets a recovery. Anything else is
      // the "chatty when it returns" half of the failure mode above.
      emitEvent("health.recovered", `${service} recovered`, { service });
    }
  }

  function getHealthLatest(
    services: string[],
  ): Array<{ service: string; status: string; message: string; timestamp: number }> {
    const results: Array<{ service: string; status: string; message: string; timestamp: number }> = [];
    for (const service of services) {
      const row = db
        .select()
        .from(healthChecks)
        .where(eq(healthChecks.service, service))
        .orderBy(desc(healthChecks.timestamp))
        .limit(1)
        .get();
      if (row) {
        results.push({ service: row.service, status: row.status, message: row.message, timestamp: row.timestamp });
      }
    }
    return results;
  }

  function getHealthHistory(service: string, since: number): Array<{ status: string; timestamp: number }> {
    return db
      .select({ status: healthChecks.status, timestamp: healthChecks.timestamp })
      .from(healthChecks)
      .where(and(eq(healthChecks.service, service), gte(healthChecks.timestamp, since)))
      .orderBy(healthChecks.timestamp)
      .all();
  }

  // Keep the table from growing unbounded — delete entries older than 7 days
  function pruneHealthChecks(): void {
    const cutoff = Date.now() - WEEK_MS;
    db.delete(healthChecks)
      .where(sql`${healthChecks.timestamp} < ${cutoff}`)
      .run();
  }

  return {
    healthServices,
    renameArrHealthServices,
    checkServiceHealth,
    checkAllConfiguredServices,
    reportHealth,
    getHealthLatest,
    getHealthHistory,
    pruneHealthChecks,
  };
}

export type Health = ReturnType<typeof createHealth>;

export const HealthToken = token<Health>("health");
