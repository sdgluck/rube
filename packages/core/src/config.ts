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

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, config } from "@tinkerbell/db";

export const configSchema = z.object({
  global_plex_url: z.string(),
  global_plex_token: z.string(),
  global_plex_libraries: z.array(z.string()),
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
  media_columns: z.array(z.object({ id: z.string(), visible: z.boolean() })),
  stats_summary_tiles: z.array(z.string()).max(6),
  stats_panel_order: z.array(z.string()).max(20),
  posters_kometa_enabled: z.boolean(),
  posters_kometa_person_style: z.enum(["bw", "rainier", "signature", "diiivoy", "diiivoycolor"]),
  migration_kometa_state: z.object({
    count: z.number(),
    scannedAt: z.number(),
    bySection: z.array(z.object({ sectionId: z.string(), sectionTitle: z.string(), count: z.number() })),
  }),
  migration_kometa_dismissed_at: z.number(),
  migration_kometa_completed_at: z.number(),
  /**
   * Transient slot the Settings → Migrate page writes into right before
   * kicking off the migrate-kometa command. The command reads it at run
   * start and clears it on success. Held in config so the Sidequest worker
   * thread doesn't need any additional plumbing to receive the user's
   * selection.
   */
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
