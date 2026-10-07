#!/usr/bin/env node
/**
 * Runs the screenshot capture inside the Playwright image.
 *
 * Everything inside Chromium was already pinned, but the font rasteriser is
 * part of the operating system: macOS draws glyphs through CoreText, Linux
 * through FreeType, and the same page lands on different pixels. Since these
 * images are committed and diffed, the renderer has to be fixed too — so the
 * capture runs in a container and the host only supplies the source and takes
 * the PNGs back.
 *
 * `pnpm screenshots:local` still runs it natively, which is much faster and
 * fine while iterating on shots — just don't commit the result, because it
 * will differ from everyone else's.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
// Resolve from the workspace that actually depends on Playwright — pnpm's
// strict layout means the repo root can't see it.
const require = createRequire(join(repoRoot, "apps/tinkerbell.dev/package.json"));

const t0 = Date.now();
const since = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

// The suite is committed and the pre-commit hook hashes formatted source, so
// the capture has to run against formatted files.
//
// Only the files this worktree has touched can be unformatted — everything else
// went through the pre-commit hook — so that is all this formats. The full sweep
// is still `pnpm format`; it reads 578 files to rewrite none of them, which is
// most of a second on a run that is trying to stay under half a minute.
//
// The extensions come from the root `format` script rather than a second list
// here, and if that script is ever written in a way this can't read, it runs
// whole. `oxfmt` lives in the workspace bin directory, which is only on PATH
// when pnpm put it there, so this puts it there itself.
const formatCommand = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts.format;
const formatEnv = { ...process.env, PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH}` };
const extensions = [...formatCommand.matchAll(/'\*(\.[a-z]+)'/g)].map((m) => m[1]);

function changedFiles() {
  const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  return [
    ...git(["diff", "--name-only", "--diff-filter=d", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ].filter((file) => extensions.some((ext) => file.endsWith(ext)));
}

const targets = extensions.length > 0 ? changedFiles() : null;
const format =
  targets === null
    ? spawnSync(formatCommand, { cwd: repoRoot, shell: true, stdio: "inherit", env: formatEnv })
    : targets.length === 0
      ? { status: 0 }
      : spawnSync("oxfmt", targets, { cwd: repoRoot, stdio: "inherit", env: formatEnv });
if (format.status !== 0) {
  process.stderr.write("\ncapture-docker: formatting failed; not capturing against unformatted source.\n\n");
  process.exit(1);
}

function fail(message) {
  process.stderr.write(`\ncapture-docker: ${message}\n\n`);
  process.exit(1);
}

// ── The daemon ──────────────────────────────────────────────────────────────
const daemon = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
if (daemon.error) {
  fail("docker isn't on PATH.\n\n  Iterate without it:  pnpm screenshots:local");
}
if (daemon.status !== 0) {
  fail(
    "the docker daemon isn't running — start Docker Desktop or OrbStack and retry.\n\n" +
      "  Iterate without it:  pnpm screenshots:local  (faster, but the pixels\n" +
      "                       differ from a containerised run, so don't commit them)",
  );
}

// ── Version coupling ────────────────────────────────────────────────────────
// The base image ships a Chromium built for one Playwright release; a mismatch
// against the installed driver fails at connect time with nothing useful said.
const playwrightVersion = require("playwright/package.json").version;

// ── Build ───────────────────────────────────────────────────────────────────
// Cheap after the first run: dependencies key on the lockfile, so a UI edit
// only invalidates the source layer.
const image = `tinkerbell-capture:${playwrightVersion}`;
console.log(`→ building ${image} (${since()})`);
const build = spawnSync(
  "docker",
  [
    "build",
    "-f",
    "apps/tinkerbell.dev/harness/Dockerfile",
    "--build-arg",
    `PLAYWRIGHT_VERSION=${playwrightVersion}`,
    "-t",
    image,
    ".",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);
if (build.status !== 0) fail("image build failed");

// ── Run ─────────────────────────────────────────────────────────────────────
// Only the outputs are mounted. The source is in the image, copied at build
// time, so a macOS node_modules can never be loaded by a Linux process.
const outputs = [
  join(repoRoot, "screenshots"),
  join(repoRoot, "apps/tinkerbell.dev/public/screenshots"),
  join(repoRoot, "apps/tinkerbell.dev/public/posters"),
];
for (const dir of outputs) mkdirSync(dir, { recursive: true });

// The container has no git index, so the hash of what is about to be committed
// can only be computed out here.
const { uiHashFromWorktree } = await import(join(repoRoot, "scripts/ui-hash.mjs"));
const uiHash = uiHashFromWorktree(repoRoot);

const uid = typeof process.getuid === "function" ? process.getuid() : null;
const gid = typeof process.getgid === "function" ? process.getgid() : null;

console.log(`→ capturing in ${image} (${since()})`);
const run = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--init",
    // Chromium will exhaust the default 64 MB /dev/shm and crash a tab.
    "--shm-size=1g",
    ...(uid !== null && gid !== null ? ["--user", `${uid}:${gid}`] : []),
    // pnpm and Playwright both want somewhere writable to call home, which
    // /nonexistent isn't once --user overrides the image's root.
    "-e",
    "HOME=/tmp",
    "-e",
    `TB_UI_HASH=${uiHash}`,
    ...(process.env.TB_CAPTURE_CONCURRENCY ? ["-e", `TB_CAPTURE_CONCURRENCY=${process.env.TB_CAPTURE_CONCURRENCY}`] : []),
    "-v",
    `${join(repoRoot, "screenshots")}:/repo/screenshots`,
    "-v",
    `${join(repoRoot, "apps/tinkerbell.dev/public/screenshots")}:/repo/apps/tinkerbell.dev/public/screenshots`,
    "-v",
    `${join(repoRoot, "apps/tinkerbell.dev/public/posters")}:/repo/apps/tinkerbell.dev/public/posters`,
    image,
  ],
  { cwd: repoRoot, stdio: "inherit" },
);
console.log(`\n→ done (${since()})`);
process.exit(run.status ?? 1);
