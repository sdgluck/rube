/**
 * SQLite-backed key/value config store.
 *
 * Usage:
 *   import { getConfig, setConfig, getAllConfig, deleteConfig } from "./config.mjs";
 *   await setConfig("plex_url", "http://localhost:32400");
 *   const url = await getConfig("plex_url");
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const DB_PATH = join(import.meta.dirname, "tinkerbell.db");

let db;

function getDb() {
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

export function getConfig(key) {
  const row = getDb().prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row ? row.value : undefined;
}

export function setConfig(key, value) {
  getDb()
    .prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value));
}

export function deleteConfig(key) {
  getDb().prepare("DELETE FROM config WHERE key = ?").run(key);
}

export function getAllConfig() {
  const rows = getDb().prepare("SELECT key, value FROM config ORDER BY key").all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
