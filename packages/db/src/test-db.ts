/**
 * A throwaway, fully migrated database for a test.
 *
 * The helper this replaced (`setupTempDb`) had to mkdtemp a directory, point
 * `process.env.DATA_DIR` at it, and spawn `migrate.ts` as a **subprocess**, all
 * before anything that transitively imported `@tinkerbell/db` was allowed to
 * load — which is why forty-odd test files imported their subject with a
 * dynamic `await import()` in a hand-maintained order. None of that was about
 * testing; it was working around a connection opened at import time.
 *
 * With `createDb` taking its path as an argument, a test just asks for one:
 *
 *     const { db, dispose } = createTestDb();
 *     after(dispose);
 *
 * Migrations are applied in-process here because this is test scaffolding, not
 * application code — the production path is unchanged and still runs the
 * migrator as its own entrypoint step before any app process starts.
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, closeDb, type Db } from "./index.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");

export interface TestDb {
  db: Db;
  /** The temp directory, for the rare test that needs a path on disk. */
  dataDir: string;
  dispose(): void;
}

/**
 * A fresh database with the current schema applied.
 *
 * On disk rather than `:memory:` deliberately — `journal_mode = WAL` and the
 * mmap pragmas are no-ops in memory, and a test that passes only against a
 * different storage mode than production is worth less than the milliseconds
 * it saves.
 */
export function createTestDb(prefix = "tinkerbell-test-"): TestDb {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const db = createDb({ dataDir });
  // A fresh file never needs `migrate.ts`'s legacy push-managed bootstrap —
  // that path exists for databases provisioned before `__drizzle_migrations`,
  // and this one was created a line ago.
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  return {
    db,
    dataDir,
    dispose() {
      closeDb(db);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
