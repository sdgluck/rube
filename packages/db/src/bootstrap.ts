/**
 * The legacy push-managed bootstrap, split out of `migrate.ts` so it can be
 * tested.
 *
 * `migrate.ts` is an entrypoint: it opens a database and applies migrations at
 * module scope, so importing it to test this function would run the migrator
 * against whatever `DATA_DIR` happened to be. That is why the one piece of
 * genuinely intricate logic in the package — the piece whose failure mode is a
 * *silently skipped migration on somebody else's install* — had no test.
 *
 * What it does: a database provisioned by `drizzle-kit push` before
 * `__drizzle_migrations` existed already has the tables, but no record of
 * having been migrated. Left alone, `migrate()` would try to re-create them and
 * crash on the first `CREATE TABLE`. So the migrations table is seeded with the
 * journal entries up to the point where push was still possible, and drizzle
 * then applies only what came after.
 *
 * The hash must match what drizzle itself would have written — sha256 over the
 * raw SQL file — or drizzle sees an unknown hash and re-runs the migration.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

/**
 * Capped at the last journal entry that was shipped when push-managed
 * deployments were possible. New migrations beyond this idx must run on legacy
 * DBs to actually create their tables; do NOT raise this number when adding a
 * migration (the legacy bootstrap window is closed).
 */
export const BOOTSTRAP_BASELINE_IDX = 5;

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

/**
 * Seed `__drizzle_migrations` on a legacy push-managed database.
 *
 * Returns the number of entries written — 0 when nothing needed doing, which
 * is the case for every database created since the bootstrap window closed.
 */
export function bootstrapPushedDatabase(sqlite: Database, migrationsDir: string): number {
  const migrationsTableExists = sqlite
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (migrationsTableExists) return 0;

  const userTableExists = sqlite
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='config'")
    .get();
  if (!userTableExists) return 0; // fresh DB — let migrate() create everything

  const journalPath = join(migrationsDir, "meta", "_journal.json");
  const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, "utf8"));

  sqlite.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  const insert = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  let count = 0;
  for (const entry of journal.entries) {
    if (entry.idx > BOOTSTRAP_BASELINE_IDX) continue;
    const sql = readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    insert.run(hash, entry.when);
    count++;
  }
  return count;
}
