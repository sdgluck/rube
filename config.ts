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

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { z } from "zod";

export const configSchema = z.object({
  global_plex_url: z.string(),
  global_plex_token: z.string(),
  global_plex_libraries: z.array(z.string()),
  global_anthropic_api_key: z.string(),
  scheduler_sections: z.array(z.string()),
  scheduler_limit: z.string(),
  scheduler_verbose: z.string(),
  byw_plex_user: z.string(),
});

export type ConfigSchema = typeof configSchema;
export type ConfigKey = keyof z.infer<ConfigSchema>;
export type ConfigValue<K extends ConfigKey> = z.infer<ConfigSchema>[K];

const DB_PATH = join(import.meta.dirname, "tinkerbell.db");

let db: DatabaseSync | undefined;

function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  }
  return db;
}

export function getConfig<K extends ConfigKey>(key: K): ConfigValue<K> | undefined {
  const row = getDb().prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  const raw = JSON.parse(row.value);
  return configSchema.shape[key].parse(raw) as ConfigValue<K>;
}

export function setConfig<K extends ConfigKey>(key: K, value: ConfigValue<K>): void {
  getDb()
    .prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

export function deleteConfig(key: ConfigKey): void {
  getDb().prepare("DELETE FROM config WHERE key = ?").run(key);
}

export function getAllConfig(): Partial<z.infer<ConfigSchema>> {
  const rows = getDb().prepare("SELECT key, value FROM config ORDER BY key").all() as Array<{
    key: string;
    value: string;
  }>;
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.key in configSchema.shape) {
      raw[row.key] = JSON.parse(row.value);
    }
  }
  return configSchema.partial().parse(raw);
}
