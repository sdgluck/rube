/**
 * A throwaway, fully migrated database for a test.
 *
 * The helper this replaced (`setupTempDb`) had to mkdtemp a directory, point
 * `process.env.DATA_DIR` at it, and spawn `migrate.ts` as a **subprocess**, all
 * before anything that transitively imported `@rube/db` was allowed to
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
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, closeDb, type Db } from "./index.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");
const DB_FILE = "rube.db";

/**
 * Applying the 56 migrations costs ~65ms, and the suite asks for a database
 * hundreds of times across 163 test files — tens of seconds of the wall clock
 * spent replaying the same DDL to reach the same empty schema.
 *
 * So do it once and copy the result. The template is keyed by a hash of the
 * migration SQL, so adding or changing a migration builds a new one and an
 * older template is simply never looked up again.
 */
function templatePath(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(join(MIGRATIONS_DIR, f)));
  }
  return join(tmpdir(), `rube-schema-${hash.digest("hex").slice(0, 16)}.db`);
}

let template: string | undefined;

function ensureTemplate(): string {
  if (template && existsSync(template)) return template;

  const target = templatePath();
  if (!existsSync(target)) {
    const dir = mkdtempSync(join(tmpdir(), "rube-schema-build-"));
    const db = createDb({ dataDir: dir });
    // A fresh file never needs `migrate.ts`'s legacy push-managed bootstrap —
    // that path exists for databases provisioned before `__drizzle_migrations`,
    // and this one was created a line ago.
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    // Closing the last connection checkpoints the WAL back into the main file
    // and removes it, so the single file we copy is the whole database.
    closeDb(db);
    // Rename rather than copy into place: the suite runs 163 files at once and
    // several will build the template concurrently. Rename is atomic within a
    // filesystem, so a reader sees either no template or a complete one, never
    // a half-written file. Identical builders overwriting each other is fine.
    try {
      renameSync(join(dir, DB_FILE), target);
    } catch {
      // Another process won the race; its template is equivalent to ours.
    }
    rmSync(dir, { recursive: true, force: true });
  }

  template = target;
  return target;
}

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
export function createTestDb(prefix = "rube-test-"): TestDb {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  // Copy the migrated template instead of replaying the migrations. The result
  // is byte-identical to what `migrate` produced, `__drizzle_migrations` and
  // all, so a test cannot tell the difference.
  copyFileSync(ensureTemplate(), join(dataDir, DB_FILE));
  const db = createDb({ dataDir });

  return {
    db,
    dataDir,
    dispose() {
      closeDb(db);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
