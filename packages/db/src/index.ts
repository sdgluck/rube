import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema.ts";

const DB_PATH = join(process.env.DATA_DIR || join(import.meta.dirname, "..", "..", ".."), "tinkerbell.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("temp_store = MEMORY");
sqlite.pragma("cache_size = -65536"); // 64 MiB page cache
sqlite.pragma("mmap_size = 268435456"); // 256 MiB
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

export * from "./schema.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");
bootstrapPushedDatabase();
migrate(db, { migrationsFolder: MIGRATIONS_DIR });

// One-shot: if this DB was previously managed via `drizzle-kit push` (no
// `__drizzle_migrations` table) but already has user tables, mark the existing
// migrations as applied so `migrate()` doesn't try to re-create the schema.
//
// Capped at `BOOTSTRAP_BASELINE_IDX` — the last journal entry that was shipped
// when push-managed deployments were possible. New migrations beyond this idx
// must run on legacy DBs to actually create their tables; do NOT raise this
// number when adding a migration (the legacy bootstrap window is closed).
const BOOTSTRAP_BASELINE_IDX = 5;
function bootstrapPushedDatabase(): void {
  const migrationsTableExists = sqlite
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (migrationsTableExists) return;

  const userTableExists = sqlite
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='config'")
    .get();
  if (!userTableExists) return; // fresh DB — let migrate() create everything

  type JournalEntry = { idx: number; tag: string; when: number };
  const journalPath = join(MIGRATIONS_DIR, "meta", "_journal.json");
  const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, "utf8"));

  sqlite.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  const insert = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  let count = 0;
  for (const entry of journal.entries) {
    if (entry.idx > BOOTSTRAP_BASELINE_IDX) continue;
    const sqlPath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    insert.run(hash, entry.when);
    count++;
  }
  console.log(`[db] bootstrapped __drizzle_migrations with ${count} pre-existing migration(s)`);
}
