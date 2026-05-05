/**
 * Migration entrypoint. Runs as a discrete step before app processes start
 * (dev script, Docker entrypoint) — NOT from application code. Opens its
 * own short-lived connection so it doesn't share state with the app's
 * connection pool, applies any pending drizzle migrations, then exits.
 *
 * Also handles the legacy push-managed bootstrap: if a DB pre-dates the
 * `__drizzle_migrations` table but already has user tables (because it was
 * provisioned via `drizzle-kit push`), seed the migrations table with the
 * pre-bootstrap journal entries so `migrate()` doesn't try to re-create the
 * existing schema.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = join(process.env.DATA_DIR || join(import.meta.dirname, "..", "..", ".."), "tinkerbell.db");
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");

// Capped at the last journal entry that was shipped when push-managed
// deployments were possible. New migrations beyond this idx must run on
// legacy DBs to actually create their tables; do NOT raise this number when
// adding a migration (the legacy bootstrap window is closed).
const BOOTSTRAP_BASELINE_IDX = 5;

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
const db = drizzle(sqlite);

bootstrapPushedDatabase();
migrate(db, { migrationsFolder: MIGRATIONS_DIR });
sqlite.close();

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
