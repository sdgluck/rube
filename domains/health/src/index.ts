import { eq, desc, and, gte, sql } from "drizzle-orm";
import { errorMessage } from "@tinkerbell/core";
import { db, healthChecks } from "@tinkerbell/db";
import { emitEvent } from "@tinkerbell/domain.events";
import { getEnvironment, getPlexPrerollStatus } from "@tinkerbell/domain.prerolls";
import { getAllConfig, getConfig, getLlmConfig, configSchema, WEEK_MS } from "@tinkerbell/core";
import { createPlexClient } from "@tinkerbell/plex";
import { createLlmClient } from "@tinkerbell/llm";
import { z } from "zod";

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

export async function checkServiceHealth(service: string): Promise<void> {
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
    case "LLM": {
      const llm = getLlmConfig();
      if (!llm) throw new Error("Not configured");
      const client = createLlmClient(llm);
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
export async function checkAllConfiguredServices(signal?: AbortSignal): Promise<string> {
  const cfg = getAllConfig();
  const configured = HEALTH_SERVICES.filter((svc) => svc.configuredFn(cfg));
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

/**
 * Consecutive error checks, most recent first.
 *
 * Reads a bounded window rather than a service's whole history: the answer is
 * only ever compared against a threshold capped at 20, so anything past that
 * is the same answer.
 */
function consecutiveFailures(service: string, limit: number): number {
  const rows = db
    .select({ status: healthChecks.status })
    .from(healthChecks)
    .where(eq(healthChecks.service, service))
    .orderBy(desc(healthChecks.timestamp))
    .limit(limit)
    .all();
  let count = 0;
  for (const row of rows) {
    if (row.status !== "error") break;
    count++;
  }
  return count;
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
export function reportHealth(service: string, status: "ok" | "error", message: string): void {
  const threshold = getConfig("health_failure_threshold") ?? 1;

  // Read before the insert: `priorFailures` is the state the streak was in
  // when this check ran, which is what decides whether anything is announced.
  const prev = db
    .select({ status: healthChecks.status })
    .from(healthChecks)
    .where(eq(healthChecks.service, service))
    .orderBy(desc(healthChecks.timestamp))
    .limit(1)
    .get();
  const priorFailures = threshold > 1 ? consecutiveFailures(service, threshold) : prev?.status === "error" ? 1 : 0;

  db.insert(healthChecks).values({ service, status, message, timestamp: Date.now() }).run();

  // Nothing to compare against on a service's very first check.
  if (!prev) return;

  if (status === "error") {
    if (priorFailures + 1 === threshold) {
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
  } else if (priorFailures >= threshold) {
    emitEvent("health.recovered", `${service} recovered`, { service });
  }
}

export function getHealthLatest(
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

export function getHealthHistory(service: string, since: number): Array<{ status: string; timestamp: number }> {
  return db
    .select({ status: healthChecks.status, timestamp: healthChecks.timestamp })
    .from(healthChecks)
    .where(and(eq(healthChecks.service, service), gte(healthChecks.timestamp, since)))
    .orderBy(healthChecks.timestamp)
    .all();
}

// Keep the table from growing unbounded — delete entries older than 7 days
export function pruneHealthChecks(): void {
  const cutoff = Date.now() - WEEK_MS;
  db.delete(healthChecks)
    .where(sql`${healthChecks.timestamp} < ${cutoff}`)
    .run();
}
