#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();

const die = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  die("usage: pnpm release <patch|minor|major>");
}

if (sh("git", ["status", "--porcelain"])) {
  die("working tree not clean — commit or stash first");
}

const rootPkgPath = join(ROOT, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const [maj, min, pat] = rootPkg.version.split(".").map(Number);
const next =
  bump === "major"
    ? `${maj + 1}.0.0`
    : bump === "minor"
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;

let prevRef;
try {
  prevRef = sh("git", ["describe", "--tags", "--abbrev=0"]);
} catch {
  // No tags yet — use the v-prefixed version commit if present, else root.
  const versionCommit = sh("git", [
    "log",
    "--grep",
    "^v[0-9]",
    "-E",
    "--format=%H",
    "-n",
    "1",
  ]);
  prevRef = versionCommit || sh("git", ["rev-list", "--max-parents=0", "HEAD"]);
}

const log = sh("git", [
  "log",
  `${prevRef}..HEAD`,
  "--no-merges",
  "--pretty=format:- %s (%h)",
]);
if (!log) die(`no commits since ${prevRef}`);

console.error(`release: prev=${prevRef} next=${next}`);
console.error(`release: summarising ${log.split("\n").length} commits via claude…`);

const prompt = `You are writing a CHANGELOG entry in Keep a Changelog format.

Below is the list of commits since the last release. Group them under \`### Added\`, \`### Changed\`, \`### Fixed\`, \`### Removed\` (omit any section with no entries). Rewrite each as a user-facing bullet — no commit hashes, no internal refactor noise unless user-visible. Output ONLY the section markdown, no preamble or version header.

Commits:
${log}`;

const claude = spawnSync(
  "claude",
  ["-p", "--output-format", "text", "--model", "claude-haiku-4-5"],
  {
    cwd: ROOT,
    encoding: "utf8",
    input: prompt,
    stdio: ["pipe", "pipe", "inherit"],
    timeout: 180_000,
  },
);
if (claude.signal === "SIGTERM") die("claude timed out after 3min — likely a global hook stalling the subprocess; check ~/.claude/settings.json");
if (claude.status !== 0) die("claude summarisation failed");
const sections = claude.stdout.trim();
if (!sections) die("claude returned empty summary");

const today = new Date().toISOString().slice(0, 10);
const changelogPath = join(ROOT, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const marker = "## [Unreleased]";
if (!changelog.includes(marker)) die(`CHANGELOG.md missing "${marker}"`);
const newEntry = `${marker}\n\n## [${next}] - ${today}\n\n${sections}\n`;
writeFileSync(changelogPath, changelog.replace(marker, newEntry));

const updated = [changelogPath];
const updatePkg = (path) => {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  if (!pkg.version) return;
  pkg.version = next;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  updated.push(path);
};

updatePkg(rootPkgPath);
// `domains` was added after this script was written and was missing here, so
// those packages kept the previous version through every release.
for (const group of ["apps", "packages", "clients", "domains"]) {
  const dir = join(ROOT, group);
  for (const name of readdirSync(dir)) {
    const pkgPath = join(dir, name, "package.json");
    try {
      if (statSync(pkgPath).isFile()) updatePkg(pkgPath);
    } catch {}
  }
}

// ── Screenshots ─────────────────────────────────────────────────────────────
// After the version bump, never before: the sidebar renders a `v0.0.0` pill on
// every page, so capturing first would bake the *previous* version into all 50-
// odd images and they'd be stale the moment the release commit landed.
//
// This is the only place the suite is regenerated. It used to be enforced per
// commit by a pre-commit hook, which meant every UI one-liner paid for a
// three-minute containerised capture — so the images now move with releases
// instead, which is the granularity anyone reading them actually cares about.
if (process.env.SKIP_SCREENSHOTS === "1") {
  console.error("release: SKIP_SCREENSHOTS=1 — shipping whatever is in screenshots/ (they will be stale)");
} else {
  console.error("release: regenerating screenshots…");
  const capture = spawnSync(process.execPath, [join(ROOT, "scripts/capture-docker.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (capture.status !== 0) {
    // The version bump and CHANGELOG entry are already written at this point,
    // so say how to get back to a clean tree rather than leaving it to guesswork.
    die(
      "screenshot capture failed.\n" +
        `  The v${next} version bump and CHANGELOG entry are already in your working tree.\n` +
        "  Undo with:      git checkout -- .\n" +
        "  Or release without fresh screenshots:  SKIP_SCREENSHOTS=1 pnpm release <bump>",
    );
  }
  updated.push(join(ROOT, "screenshots"), join(ROOT, "apps/tinkerbell.dev/public/screenshots"));
}

sh("git", ["add", ...updated]);
sh("git", ["commit", "-m", `v${next}`]);
sh("git", ["tag", "-a", `v${next}`, "-m", `v${next}`]);

console.error(`\nrelease: committed and tagged v${next}`);
console.error(`release: review with 'git show v${next}', then 'git push --follow-tags' when ready`);
