/**
 * Bootstrap a throwaway SQLite database for a test file.
 *
 * `@tinkerbell/db` opens its connection at *import time* from
 * `process.env.DATA_DIR`, so this must run before anything that transitively
 * pulls in the db package. Practically that means:
 *
 *     import { setupTempDb } from "../test-support/temp-db.ts";
 *     setupTempDb();
 *     const { db, jobs } = await import("@tinkerbell/db");   // <- dynamic
 *
 * The schema is applied by spawning `packages/db/src/migrate.ts` as its own
 * process rather than calling migration code in-process: `migrate.ts` opens
 * and closes its own connection, and running it here would race the one the
 * test is about to open.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIGRATE_ENTRYPOINT = join(import.meta.dirname, "..", "..", "..", "db", "src", "migrate.ts");

/**
 * Point `DATA_DIR` at a fresh directory and apply the schema to it. Returns
 * the directory, and registers cleanup on process exit.
 */
export function setupTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "tinkerbell-jobs-test-"));
  process.env.DATA_DIR = dir;

  execFileSync(process.execPath, ["--experimental-strip-types", MIGRATE_ENTRYPOINT], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: "pipe",
  });

  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
