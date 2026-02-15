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

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        plex_rating_key TEXT PRIMARY KEY,
        section_id      TEXT NOT NULL,
        section_title   TEXT NOT NULL,
        title           TEXT NOT NULL,
        summary         TEXT DEFAULT '',
        child_count     INTEGER DEFAULT 0,
        labels          TEXT DEFAULT '[]',
        added_at        INTEGER,
        thumb           TEXT DEFAULT '',
        synced_at       INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        command   TEXT NOT NULL,
        schedule  TEXT NOT NULL DEFAULT '',
        enabled   INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_runs (
        id          TEXT PRIMARY KEY,
        job_id      TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'running',
        log         TEXT NOT NULL DEFAULT '',
        progress    REAL NOT NULL DEFAULT 0,
        message     TEXT NOT NULL DEFAULT '',
        started_at  INTEGER NOT NULL,
        finished_at INTEGER,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
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
