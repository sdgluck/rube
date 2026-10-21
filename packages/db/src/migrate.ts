/**
 * Migration entrypoint. Runs as a discrete step before app processes start
 * (dev script, Docker entrypoint) — NOT from application code. Opens its
 * own short-lived connection so it doesn't share state with the app's
 * connection pool, applies any pending drizzle migrations, then exits.
 *
 * The legacy push-managed bootstrap lives in `bootstrap.ts`: this file runs its
 * work at module scope, so anything importable had to move out of it to be
 * testable. See the note there.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { bootstrapPushedDatabase } from "./bootstrap.ts";

const DB_PATH = join(process.env.DATA_DIR || join(import.meta.dirname, "..", "..", ".."), "rube.db");
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
const db = drizzle(sqlite);

const bootstrapped = bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR);
if (bootstrapped > 0) {
  console.log(`[db] bootstrapped __drizzle_migrations with ${bootstrapped} pre-existing migration(s)`);
}
migrate(db, { migrationsFolder: MIGRATIONS_DIR });
sqlite.close();
