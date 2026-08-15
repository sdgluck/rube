/**
 * Bootstrap a throwaway SQLite database for a test file.
 *
 * `@tinkerbell/db` opens its connection at *import time* from
 * `process.env.DATA_DIR`, so this must run before anything that transitively
 * pulls in the db package. Practically that means:
 *
 *     import { setupTempDb } from "@tinkerbell/db/test-support";
 *     setupTempDb();
 *     const { db, jobs } = await import("@tinkerbell/db");   // <- dynamic
 *
 * The schema is applied by spawning `packages/db/src/migrate.ts` as its own
 * process rather than calling migration code in-process: `migrate.ts` opens
 * and closes its own connection, and running it here would race the one the
 * test is about to open.
 *
 * Lives in `@tinkerbell/db` rather than beside any one package's tests because
 * this package owns both the schema and the migrate entrypoint, and more than
 * one workspace now needs a migrated scratch database.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIGRATE_ENTRYPOINT = join(import.meta.dirname, "migrate.ts");

/**
 * Point `DATA_DIR` at a fresh directory and apply the schema to it. Returns
 * the directory, and registers cleanup on process exit.
 */
export function setupTempDb(prefix = "tinkerbell-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DATA_DIR = dir;

  execFileSync(process.execPath, ["--experimental-strip-types", MIGRATE_ENTRYPOINT], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: "pipe",
  });

  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
