#!/usr/bin/env node
/**
 * Puts the recommender model that `models/recs.json` pins at `models/recs.bin`.
 *
 * The model is ~25MB and changes rarely, so it is a release asset (`recs-v*`
 * tags) rather than a committed file: committing it would add its whole size
 * to the repo's history on every retrain. `models/recs.json` is what source
 * and model agree on, and the sha256 in it is checked here, so a stale or
 * truncated file is replaced rather than shipped.
 *
 * Without `--require` (the dev script) a failure is a warning: the app runs
 * fine without the model — the feature reports itself unavailable. With it
 * (CI, before `docker build`) a failure fails the build, so a published image
 * can never silently lack the model.
 *
 * Uses `gh`, because the repo is private: in CI it authenticates from
 * `GH_TOKEN`, locally from `gh auth login`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const REPO = "sdgluck/tinkerbell";
const require = process.argv.includes("--require");
const pin = JSON.parse(readFileSync(join(ROOT, "models", "recs.json"), "utf8"));
const target = join(ROOT, "models", "recs.bin");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fail(message) {
  if (require) {
    console.error(`fetch-recs-model: ${message}`);
    process.exit(1);
  }
  console.warn(`fetch-recs-model: ${message} — the built-in recommender will be unavailable.`);
  process.exit(0);
}

if (existsSync(target) && sha256(target) === pin.sha256) process.exit(0);

try {
  execFileSync(
    "gh",
    ["release", "download", pin.tag, "--repo", REPO, "--pattern", pin.asset, "--output", target, "--clobber"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (err) {
  fail(`couldn't download ${pin.asset} from release ${pin.tag} (${err.stderr?.toString().trim() || err.message})`);
}

const got = sha256(target);
if (got !== pin.sha256) {
  rmSync(target);
  fail(`${pin.asset} has sha256 ${got}, but models/recs.json pins ${pin.sha256}`);
}
console.log(`fetch-recs-model: models/recs.bin is model v${pin.version}`);
