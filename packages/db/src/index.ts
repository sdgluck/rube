import Database, { type Database as SqliteHandle } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { token } from "@rube/container";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export * from "./like.ts";

/**
 * The drizzle handle, bound to this repo's schema.
 *
 * `$client` is part of the type because disposal needs it: the container closes
 * the connection through `closeDb`, and without the underlying handle in the
 * type there is nothing to close.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteHandle };

/**
 * The database, as a container token.
 *
 * Lives here rather than in `@rube/ports` because this package owns the
 * type — ports holds only the edges that have no owner. `@rube/db`
 * depends on nothing but the container kernel, so nobody who needs the token
 * inherits a dependency they didn't want.
 */
export const DbToken = token<Db>("db");

/**
 * Where the database file lives when nobody says otherwise: `DATA_DIR`, else
 * the repo root. Exported so `@rube/composition` can read the
 * environment in one place rather than every consumer doing it.
 */
export function defaultDataDir(): string {
  return process.env.DATA_DIR || join(import.meta.dirname, "..", "..", "..");
}

export interface CreateDbOptions {
  dataDir: string;
  /** Overridden only by tests, which want a throwaway file per suite. */
  fileName?: string;
}

/**
 * Open a connection.
 *
 * This used to be an import-time side effect — `packages/db` opened SQLite the
 * moment anything imported it, from `process.env.DATA_DIR`. That single line is
 * what forced every test touching a domain to mkdtemp a directory, mutate the
 * environment, spawn `migrate.ts` as a subprocess and then `await import()`
 * everything in a specific order, because by the time a static import ran the
 * connection was already open against the wrong file.
 *
 * Migrations are still NOT applied here. They run as a discrete entrypoint step
 * (dev script, Docker entrypoint) via `pnpm --filter @rube/db migrate` —
 * see `migrate.ts`. Application code assumes the schema is already current.
 */
export function createDb(opts: CreateDbOptions): Db {
  const sqlite = new Database(join(opts.dataDir, opts.fileName ?? "rube.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("cache_size = -65536"); // 64 MiB page cache
  sqlite.pragma("mmap_size = 268435456"); // 256 MiB
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

/** Disposer for the `DbToken` registration. */
export function closeDb(db: Db): void {
  db.$client.close();
}
