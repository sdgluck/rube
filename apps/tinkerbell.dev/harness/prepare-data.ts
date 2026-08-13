/**
 * Builds a throwaway capture database: migrate, then seed the synthetic
 * dataset. Split out of capture.ts so it can also run at image build time —
 * the result is the same bytes every run, and doing it once in a layer takes
 * two seconds off every capture.
 *
 * Usage: node --experimental-strip-types prepare-data.ts <dataDir> <mockOrigin>
 *
 * The origin is an argument rather than a constant because what gets stored is
 * the Plex URL the seeded config points at; the harness checks the one it baked
 * still matches the mock it actually started, and re-prepares if it doesn't.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { FIXED_NOW } from "./clock.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "../..");

const [dataDir, mockOrigin] = process.argv.slice(2);
if (!dataDir || !mockOrigin) {
  throw new Error("Usage: prepare-data.ts <dataDir> <mockOrigin>");
}

function run(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
  return new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} → exit ${code}`))));
    p.on("error", rej);
  });
}

// The frozen clock has to be in place for the seed: rows that take their
// timestamp from the wall clock rather than FIXED_NOW would otherwise date the
// screenshots to whenever this ran.
const env = { DATA_DIR: dataDir, TB_FIXED_NOW: String(FIXED_NOW), TZ: "UTC" };
const preload = resolve(__dirname, "deterministic.mjs");

// better-sqlite3 won't create the directory the database lives in.
await mkdir(dataDir, { recursive: true });

// packages/db's own `migrate` script, run directly: going through
// `pnpm --filter` to reach one `node src/migrate.ts` cost more in pnpm's
// start-up than the migration itself takes.
await run("node", ["src/migrate.ts"], { cwd: resolve(repoRoot, "packages/db"), env });
await run("node", ["--import", preload, "--experimental-strip-types", "harness/seed.ts"], {
  cwd: appDir,
  env: { ...env, MOCK_PLEX_URL: mockOrigin },
});
