// Runs the whole suite as ONE `node --test` process instead of 63 turbo tasks.
//
// Packages resolve each other as raw TypeScript, so every test process
// re-strips its whole transitive import graph on startup. `turbo run test` gave
// each of the 63 packages its own `node --test`, and each of those spawned one
// child per test file at `availableParallelism() - 1` concurrency — turbo's
// default of 10 concurrent tasks therefore put ~110 node processes on a 12-core
// machine. They spent their time context-switching, not testing: 4m16s wall at
// 126% CPU, i.e. ten idle cores while the suite crawled.
//
// One process owning all 163 files schedules them against the real core count
// and finishes in ~45s at ~500% CPU. Nothing about the tests changed; only who
// decides what runs when.
//
// Two things that look like improvements and are not, both measured:
//   - `--experimental-test-isolation=none` (one shared process per shard) is
//     slower *and* wrong here — files leak global state into each other, and
//     three shards failed on mocks a neighbouring file had installed.
//   - Sorting longest-file-first packs worse, not better (56s vs 44s). git's
//     order groups files by package, so neighbours share a warm import graph
//     and the heavy DB/HTTP files stay spread out instead of colliding.
//
// Usage: `pnpm test` for everything, `pnpm test rules overlays` to filter by
// path substring, and any `-`-prefixed argument is forwarded to `node --test`
// (e.g. `pnpm test --test-name-pattern="retention"`).

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
// `--coverage` is ours; every other `-` argument belongs to `node --test`.
const coverage = args.includes("--coverage");
const passThrough = args.filter((a) => a.startsWith("-") && a !== "--coverage");
const filters = args.filter((a) => !a.startsWith("-"));

// git ls-files, as `pnpm lint` and `pnpm format` do — it already knows about
// ignored and generated files, so the runner cannot pick up a stray build
// artefact from someone's working tree.
const listed = spawnSync("git", ["ls-files", "-z", "*.test.ts"], { cwd: root, encoding: "utf8" });
if (listed.status !== 0) {
  console.error(listed.stderr || "git ls-files failed");
  process.exit(1);
}

// Split on the NUL that `-z` emits, written as an escape because
// `scripts/check-nul.mjs` rejects a raw NUL byte in a source file.
let files = listed.stdout.split("\u0000").filter(Boolean);
if (filters.length > 0) files = files.filter((f) => filters.some((s) => f.includes(s)));

if (files.length === 0) {
  console.error(filters.length ? `no test files match: ${filters.join(", ")}` : "no test files found");
  process.exit(1);
}

// V8's code cache, persisted across runs. Worth ~4s of the ~45s, and it costs
// nothing: node keys entries on file content and its own version, so a stale
// entry is a miss rather than a wrong answer.
const env = {
  ...process.env,
  NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE
    ?? path.join(root, "node_modules", ".cache", "tinkerbell-v8"),
};

// Node defaults to `availableParallelism() - 1`, which assumes each file keeps
// a core busy. These do not: they wait on sqlite and on the mock Plex and *Arr
// servers, so a core-count default leaves the machine at ~450% of 1200%.
// Oversubscribing fills that gap. Measured on 12 cores: 11 → 45s, 20 → 41.5s,
// 32 → 47s, so the curve turns back up once the processes start fighting over
// memory bandwidth rather than waiting on I/O.
const concurrency = passThrough.some((a) => a.startsWith("--test-concurrency"))
  ? []
  : ["--test-concurrency=20"];

const child = spawn(
  process.execPath,
  [
    "--test",
    "--experimental-strip-types",
    ...(coverage ? ["--experimental-test-coverage"] : []),
    ...concurrency,
    ...passThrough,
    ...files,
  ],
  { cwd: root, env, stdio: "inherit" },
);

child.on("close", (code) => process.exit(code ?? 1));
