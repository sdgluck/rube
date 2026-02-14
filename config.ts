/**
 * SQLite-backed key/value config store.
 *
 * Usage:
 *   import { getConfig, setConfig, getAllConfig, deleteConfig } from "./config.ts";
 *   await setConfig("plex_url", "http://localhost:32400");
 *   const url = await getConfig("plex_url");
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

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

export function getConfig(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : undefined;
}

export function setConfig(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value));
}

export function deleteConfig(key: string): void {
  getDb().prepare("DELETE FROM config WHERE key = ?").run(key);
}

export function getAllConfig(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM config ORDER BY key").all() as Array<{
    key: string;
    value: string;
  }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
