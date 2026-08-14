/**
 * SQLite-backed key/value config store with a typed Zod schema.
 *
 * Usage:
 *   import { getConfig, setConfig, getAllConfig } from "./config.ts";
 *   setConfig("global_plex_url", "http://localhost:32400");
 *   const url = getConfig("global_plex_url");   // string | undefined
 *   setConfig("global_plex_libraries", ["Movies", "TV"]);
 *   const libs = getConfig("global_plex_libraries"); // string[] | undefined
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, config } from "@tinkerbell/db";

/**
 * Does the runtime's ICU data recognise this timezone?
 *
 * An empty string is accepted as "unset" — that's how the Settings form clears
 * the setting back to following the server's own clock.
 */
export function isValidTimezone(value: string): boolean {
  if (value.trim() === "") return true;
  try {
    // Throws RangeError on an unknown zone. This is the same check croner
    // performs internally, done somewhere we can still report it to the user.
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const configSchema = z.object({
  global_plex_url: z.string(),
  global_plex_token: z.string(),
  global_plex_libraries: z.array(z.string()),
  /**
   * IANA timezone every cron schedule is evaluated in (e.g. "Europe/London").
   * Unset means "use the container's local time" (`process.env.TZ`, else the
   * host default). Without this, `0 3 * * *` silently follows whatever the
   * container thinks local time is and double-fires or skips on DST changes.
   *
   * Deliberately a plain `z.string()`, validated at the write boundary
   * (`configRouter.save`) rather than here. `configSchema` is used on *read*
   * too — `getConfig` parses the stored value, and `getAllConfig` parses the
   * whole blob — so a `.refine()` would turn one bad row into a throw out of
   * every config read, which is a worse failure than the one it prevents.
   * `schedulerTimezone()` re-checks whatever it finds before use.
   */
  global_timezone: z.string(),
  /**
   * Master switch for per-user personalization. When `enabled`, every Plex
   * item carries the `Tinkerbell` label and every shared user is restricted
   * to `[Tinkerbell, User:<self>]`, which is what makes per-user collections
   * (BYW, the portal) visible only to their owner. `enabling`/`disabling`
   * are transient states while the long-running jobs run.
   */
  global_personalized_sharing: z.object({
    status: z.enum(["disabled", "enabling", "enabled", "disabling"]),
    enabledAt: z.number().optional(),
    lastReconcileAt: z.number().optional(),
  }),
  /** Stable X-Plex-Client-Identifier for the Sign-in-with-Plex portal flow. */
  global_plex_client_id: z.string(),
  /** Public base URL of the user portal, used as the Plex auth forwardUrl. */
  user_app_public_url: z.string(),
  /** Admin-customizable look of the user portal (header + background). */
  portal_branding: z.object({
    title: z.string().optional(),
    icon: z.string().optional(),
    iconColor: z.string().optional(),
    // A URL or a base64 data URL (uploaded image). Capped to keep the config
    // row — and the payload shipped to the browser — to a sane size.
    backgroundImage: z.string().max(8_000_000).optional(),
  }),
  global_anthropic_api_key: z.string(),
  global_llm: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "ollama", "openai-compatible"]),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }),
  global_radarr_url: z.string(),
  global_radarr_api_key: z.string(),
  global_sonarr_url: z.string(),
  global_sonarr_api_key: z.string(),
  global_seerr_url: z.string(),
  global_seerr_api_key: z.string(),
  global_omdb_api_key: z.string(),
  global_mdblist_api_key: z.string(),
  global_tmdb_api_key: z.string(),
  global_tmdb_region: z.string(),
  global_pushover_api_key: z.string(),
  global_pushover_user_key: z.string(),
  global_pushover_events: z.array(z.string()),
  global_pushover_jobs: z.array(z.string()),
  global_pushover_health_targets: z.array(z.string()),
  global_discord_webhook_url: z.string(),
  global_discord_events: z.array(z.string()),
  global_discord_jobs: z.array(z.string()),
  global_discord_health_targets: z.array(z.string()),
  global_gotify_url: z.string(),
  global_gotify_token: z.string(),
  global_gotify_events: z.array(z.string()),
  global_gotify_jobs: z.array(z.string()),
  global_gotify_health_targets: z.array(z.string()),
  global_lunasea_webhook_url: z.string(),
  global_lunasea_events: z.array(z.string()),
  global_lunasea_jobs: z.array(z.string()),
  global_lunasea_health_targets: z.array(z.string()),
  global_pushbullet_token: z.string(),
  global_pushbullet_events: z.array(z.string()),
  global_pushbullet_jobs: z.array(z.string()),
  global_pushbullet_health_targets: z.array(z.string()),
  global_slack_webhook_url: z.string(),
  global_slack_events: z.array(z.string()),
  global_slack_jobs: z.array(z.string()),
  global_slack_health_targets: z.array(z.string()),
  global_telegram_bot_token: z.string(),
  global_telegram_chat_id: z.string(),
  global_telegram_send_silently: z.boolean(),
  global_telegram_events: z.array(z.string()),
  global_telegram_jobs: z.array(z.string()),
  global_telegram_health_targets: z.array(z.string()),
  global_webhook_url: z.string(),
  global_webhook_events: z.array(z.string()),
  global_webhook_jobs: z.array(z.string()),
  global_webhook_health_targets: z.array(z.string()),
  /**
   * Fraction of an item's runtime past which a play counts as "watched".
   *
   * This is the definition every downstream consumer inherits — watched-by-all
   * filters, cleanup rules, digests — so it is deliberately one setting rather
   * than a per-feature threshold. 0.85 matches Tautulli's default and leaves
   * room for credits.
   */
  playback_completion_threshold: z.number().min(0.5).max(1),
  /** Days of raw session rows to keep. 0 = keep forever. `watch_state` is never pruned. */
  playback_retention_days: z.number().int().min(0),
  /**
   * Whether the server owner counts towards "watched by everyone".
   *
   * Off by default: the owner is usually the person curating the library
   * rather than watching it end to end, so including them makes
   * `tb.watchedByAll` mean "and the admin got round to it too" — which on a
   * cleanup rule is the difference between deleting a finished show and never
   * deleting anything.
   */
  watch_state_all_users_include_owner: z.boolean(),
  media_columns: z.array(z.object({ id: z.string(), visible: z.boolean() })),
  stats_summary_tiles: z.array(z.string()).max(6),
  stats_panel_order: z.array(z.string()).max(20),
  jobs_summary_tiles: z.array(z.string()).max(6),
  jobs_panel_order: z.array(z.string()).max(20),
  /**
   * Where Plex sees Tinkerbell's prerolls directory. Tinkerbell writes files
   * under `PREROLLS_DIR`; Plex resolves `CinemaTrailersPrerollID` against its
   * own filesystem, so the same directory usually has a different mount point
   * in each container. This is that prefix — the Sonarr/Radarr "remote path
   * mapping" idea, reduced to the single directory we care about.
   */
  prerolls_plex_path: z.string(),
  /**
   * How Plex plays the pool. `random` joins the paths with `,` (Plex picks
   * one per playback); `sequential` joins with `;` (Plex plays them in order).
   * The separator is Plex's convention, not ours.
   */
  prerolls_mode: z.enum(["random", "sequential"]),
  /** Downscale ceiling for the transcoder. */
  prerolls_max_height: z.number().int().positive(),
  posters_kometa_enabled: z.boolean(),
  posters_kometa_person_style: z.enum(["bw", "rainier", "signature", "diiivoy", "diiivoycolor"]),
  /**
   * Per-provider scan results, keyed by provider id (e.g. "kometa"). Each
   * provider's scan job writes its own slot; the migration domain aggregates
   * across all of them for the banner / Settings → Migrate UI.
   */
  migration_state: z.record(
    z.string(),
    z.object({
      count: z.number(),
      scannedAt: z.number(),
      bySection: z.array(z.object({ sectionId: z.string(), sectionTitle: z.string(), count: z.number() })),
    }),
  ),
  migration_dismissed_at: z.record(z.string(), z.number()),
  migration_completed_at: z.record(z.string(), z.number()),
  /**
   * Transient slot the Settings → Migrate page writes into right before
   * kicking off the migrate-collections command. The command reads it at run
   * start and clears it on success. Held in config so the Sidequest worker
   * thread doesn't need any additional plumbing to receive the user's
   * selection. Only one pending plan exists at a time across all providers
   * — `providerId` identifies which provider the run belongs to.
   */
  migration_pending_plan: z.object({
    providerId: z.string(),
    items: z.array(
      z.object({
        ruleType: z.string(),
        ruleName: z.string(),
        sectionId: z.string(),
        ruleConfig: z.record(z.string(), z.unknown()),
        replacesRatingKeys: z.array(z.string()),
      }),
    ),
    deleteOriginals: z.boolean(),
    submittedAt: z.number(),
  }),
  /**
   * Last successful fetch of the public rule registry, cached so browsing the
   * catalogue doesn't hit tinkerbell.dev on every render. Stored loosely
   * (`z.unknown()` for the payload) because the authority on the registry's
   * shape is `registryIndexSchema` in `@tinkerbell/contracts`, which
   * `domains/registry` re-validates on read — duplicating it here would mean
   * two schemas to keep in step, and a format bump would fail as an opaque
   * config-parse error rather than the actionable "update Tinkerbell" message.
   * `url` is recorded so a changed `REGISTRY_URL` invalidates the cache.
   */
  registry_cache: z.object({
    fetchedAt: z.number(),
    url: z.string(),
    index: z.unknown(),
  }),
  /**
   * Legacy single-provider slots, kept readable for one release so a
   * one-shot migration in `domains/migration` can fold them into the
   * provider-keyed slots above. Safe to remove once shipped users have
   * upgraded.
   */
  migration_kometa_state: z.object({
    count: z.number(),
    scannedAt: z.number(),
    bySection: z.array(z.object({ sectionId: z.string(), sectionTitle: z.string(), count: z.number() })),
  }),
  migration_kometa_dismissed_at: z.number(),
  migration_kometa_completed_at: z.number(),
  migration_kometa_pending_plan: z.object({
    items: z.array(
      z.object({
        ruleType: z.string(),
        ruleName: z.string(),
        sectionId: z.string(),
        ruleConfig: z.record(z.string(), z.unknown()),
        replacesRatingKeys: z.array(z.string()),
      }),
    ),
    deleteOriginals: z.boolean(),
    submittedAt: z.number(),
  }),
});

export type ConfigSchema = typeof configSchema;
export type ConfigKey = keyof z.infer<ConfigSchema>;
export type ConfigValue<K extends ConfigKey> = z.infer<ConfigSchema>[K];

/**
 * Sent in place of a stored secret when the value is shipped to the browser.
 * `setConfig` (and the config.save tRPC mutation) treat this sentinel as
 * "keep the existing value" so the form can round-trip without erasing.
 *
 * The sentinel is freshly randomised per process so a user can't deliberately
 * (or accidentally) type it into a secret field and have the save endpoint
 * silently skip the update.
 */
export const REDACTED_SECRET = `__redacted__:${randomUUID()}`;

/**
 * Top-level config keys whose values must never be sent to the browser.
 * Webhook URLs are included because they typically contain bearer tokens.
 * `global_llm.apiKey` is a nested secret handled separately in
 * `getAllConfigForClient`.
 */
export const SECRET_KEYS = new Set<ConfigKey>([
  "global_plex_token",
  "global_anthropic_api_key",
  "global_radarr_api_key",
  "global_sonarr_api_key",
  "global_seerr_api_key",
  "global_omdb_api_key",
  "global_mdblist_api_key",
  "global_tmdb_api_key",
  "global_pushover_api_key",
  "global_pushover_user_key",
  "global_gotify_token",
  "global_pushbullet_token",
  "global_telegram_bot_token",
  "global_discord_webhook_url",
  "global_lunasea_webhook_url",
  "global_slack_webhook_url",
  "global_webhook_url",
]);

export function getConfig<K extends ConfigKey>(key: K): ConfigValue<K> | undefined {
  const row = db.select({ value: config.value }).from(config).where(eq(config.key, key)).get();
  if (row?.value === undefined || row.value === null) return undefined;
  return configSchema.shape[key].parse(row.value) as ConfigValue<K>;
}

export function setConfig<K extends ConfigKey>(key: K, value: ConfigValue<K>): void {
  db.insert(config).values({ key, value }).onConflictDoUpdate({ target: config.key, set: { value } }).run();
}

export function deleteConfig(key: ConfigKey): void {
  db.delete(config).where(eq(config.key, key)).run();
}

export type PersonalizedSharingStatus = "disabled" | "enabling" | "enabled" | "disabling";

/** Current personalization master-switch status (defaults to "disabled"). */
export function getPersonalizedSharingStatus(): PersonalizedSharingStatus {
  return getConfig("global_personalized_sharing")?.status ?? "disabled";
}

/**
 * Resolve the LLM provider config, falling back to the legacy
 * `global_anthropic_api_key` slot when `global_llm` hasn't been written yet.
 * Returns undefined when no provider is configured.
 */
export function getLlmConfig(): ConfigValue<"global_llm"> | undefined {
  const explicit = getConfig("global_llm");
  if (explicit) return explicit;
  const legacyKey = getConfig("global_anthropic_api_key");
  if (legacyKey) {
    return {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      apiKey: legacyKey,
    };
  }
  return undefined;
}

export function getAllConfig(): Partial<z.infer<ConfigSchema>> {
  const rows = db.select().from(config).all();
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.key in configSchema.shape) {
      raw[row.key] = row.value;
    }
  }
  return configSchema.partial().parse(raw);
}

/**
 * Pure transform: take a config blob and replace every secret value with
 * `REDACTED_SECRET`. Extracted from `getAllConfigForClient` so it can be
 * exercised by unit tests without standing up a SQLite instance.
 */
export function redactSecrets(input: Partial<z.infer<ConfigSchema>>): Partial<z.infer<ConfigSchema>> {
  const all = { ...input } as Record<string, unknown>;
  for (const key of SECRET_KEYS) {
    if (typeof all[key] === "string" && all[key] !== "") all[key] = REDACTED_SECRET;
  }
  const llm = all["global_llm"] as ConfigValue<"global_llm"> | undefined;
  if (llm && typeof llm.apiKey === "string" && llm.apiKey !== "") {
    all["global_llm"] = { ...llm, apiKey: REDACTED_SECRET };
  }
  return all as Partial<z.infer<ConfigSchema>>;
}

/**
 * Browser-safe variant of `getAllConfig`: keys in `SECRET_KEYS` that are
 * stored come back as `REDACTED_SECRET`; unset keys are omitted as usual.
 * `global_llm.apiKey` is a nested secret and is redacted in place.
 */
export function getAllConfigForClient(): Partial<z.infer<ConfigSchema>> {
  return redactSecrets(getAllConfig());
}
