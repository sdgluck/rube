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
  // App releases only: `recs-v*` tags carry recommender model files, and the
  // nearest one would otherwise become the changelog's starting point.
  prevRef = sh("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
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

// Bodies, not just subjects. A subject line is a label — "feat(registry): pack
// pin defaults" — and summarising a list of labels produces a changelog of
// labels: technically accurate, useless to somebody deciding whether to
// upgrade. The reasoning, the behaviour change and the upgrade note all live
// in the body, so that's what the summariser gets.
const commits = sh("git", [
  "log",
  `${prevRef}..HEAD`,
  "--no-merges",
  "--pretty=format:=== %s%n%b",
]);
if (!commits) die(`no commits since ${prevRef}`);

const commitCount = commits.split("\n").filter((l) => l.startsWith("=== ")).length;
console.error(`release: prev=${prevRef} next=${next}`);
console.error(`release: summarising ${commitCount} commits via claude…`);

const prompt = `You are writing the CHANGELOG entry for a new release of Rube, a self-hosted tool that generates Plex collections from rules. Its readers are the people who run it: they read this to decide whether to upgrade and what will change on their server when they do.

Below are the commits since the last release, each starting with "=== " followed by its subject and then its body.

Write the entry as Keep a Changelog sections — \`### Added\`, \`### Changed\`, \`### Fixed\`, \`### Removed\` — omitting any section with nothing in it.

Rules:
- One bullet per user-visible change. Say what is different for the user now, not what was refactored. Skip commits with no user-visible effect (build, CI, internal cleanup).
- Be specific. "Grouped rules now build a collection for every group by default" — not "grouped rule caps are now opt-in". Name the feature, the page, or the rule types involved so a reader can tell whether it affects them.
- Never merge unrelated changes into one bullet. If a commit did three things, give it three bullets.
- Describe where the release ends up, not the path it took. A later commit often adjusts an earlier one in the same release — relaxing a requirement it added, fixing a bug in it, renaming what it introduced. Fold the two into one bullet describing the final behaviour; never write a second bullet that restates or contradicts the first. This is the only reason to combine commits — fixes that merely share an area (several phone fixes, say) still get a bullet each.
- Keep every condition and scope exactly as the commit states it. If a commit says "a rule over films and TV", the bullet is about rules covering both films and TV — not rules covering only one, and not all rules. Never invert, widen or narrow who a change applies to. When a subject has no body and its meaning is not certain, stay close to its own words rather than guessing at a fuller explanation.
- Every bullet is a full sentence of at least ten words saying what changed, where, and for whom. Splitting a commit into several bullets does not license shorter ones — "The native apps now support live reload" is a label; say what reloads, when, and who it helps. Shorter bullets fail the release.
- A bullet must be readable on its own by someone who has not seen the commits. No commit hashes, no file or symbol names, no "as described above".
- When a change alters behaviour for existing installs — different defaults, a migration, something that has to be reconfigured — say so plainly in the bullet and lead the sentence with it. Bold the leading clause with ** for those.
- Prefer the commit body's own reasoning over inventing new framing. Do not claim anything the commits don't support.

Before answering, check two things. First, each bullet against the commits it came from: would their author agree it says the same thing, for the same users, under the same conditions? Second, that every separate change a subject lists — joined by commas or "and" — has a bullet of its own. Rewrite until both hold.

Output ONLY the section markdown. No preamble, no version header, no closing commentary.

Commits:
${commits}`;

// Opus: this is the one artefact of a release that users read, and the cost of
// a bad summary is a changelog nobody trusts. Sonnet shipped v0.36.1 with a
// bullet that inverted who a change applied to; a few dollars of model time is
// cheaper than a correction commit after the tag.
const claude = spawnSync(
  "claude",
  ["-p", "--output-format", "text", "--model", "claude-opus-5-5"],
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

// Strip anything before the first heading — a stray "Here's the changelog:"
// would otherwise land in the file verbatim.
const raw = claude.stdout.trim();
const firstHeading = raw.indexOf("### ");
// …and anything after the last bullet. Slicing from the first heading removes
// an opening ```markdown fence but leaves its closing one, which is how a bare
// ``` ended up committed in the middle of CHANGELOG.md for v0.14.1 (and, it
// turned out, at the end of the file since the very first release).
// Cut at the last bullet line itself, not just a trailing fence: v0.42.2
// shipped with "No follow-up: only the changelog section was asked for." under
// its last bullet — a closing remark a global Claude Code hook asks for, which
// `claude -p` inherits.
const lines = firstHeading === -1 ? [] : raw.slice(firstHeading).split("\n");
const lastBullet = lines.findLastIndex((l) => l.trimStart().startsWith("- "));
const sections = lines.slice(0, lastBullet + 1).join("\n").trim();

// The failures worth catching are the quiet ones: a summary that parses as
// markdown but says nothing. Both of these produced a shipped release before
// they were checks.
if (!sections) die("claude returned no `### ` sections — rerun, or write the entry by hand");
const bullets = sections.split("\n").filter((l) => l.trimStart().startsWith("- "));
if (bullets.length === 0) die("claude returned headings with no bullets");
// Eight words is where "Pin rotation is now required" sits — a label, not a
// changelog entry. Anything shorter can't have said what changed for whom.
const vague = bullets.filter((l) => l.replace(/^\s*-\s*/, "").split(/\s+/).length < 8);
if (vague.length > 0) {
  die(
    `claude returned ${vague.length} bullet(s) too terse to be useful:\n` +
      vague.map((l) => `  ${l.trim()}`).join("\n") +
      "\n  Rerun the release, or write CHANGELOG.md by hand and re-run with the entry in place.",
  );
}

// Printed in full because this is the last point where it costs nothing to
// fix: after this the entry is committed, tagged and pushed.
console.error(`\nrelease: changelog entry for v${next} —\n\n${sections}\n`);
if (process.env.CHANGELOG_DRY_RUN === "1") {
  console.error("release: CHANGELOG_DRY_RUN=1 — nothing written");
  process.exit(0);
}

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

// ── Native apps ─────────────────────────────────────────────────────────────
// The iOS and Android projects keep their own version fields, which the stores
// read, so they move in step with everything else. The build number is the
// version as one integer (0.36.1 → 36001): both stores require it to rise with
// every upload, and deriving it means a release never has to remember to bump it.
const buildNumber = next.split(".").reduce((n, part) => n * 1000 + Number(part), 0);
for (const app of ["web", "portal"]) {
  const pbxproj = join(ROOT, "apps", app, "ios/App/App.xcodeproj/project.pbxproj");
  const gradle = join(ROOT, "apps", app, "android/app/build.gradle");
  try {
    statSync(pbxproj);
  } catch {
    continue;
  }
  writeFileSync(
    pbxproj,
    readFileSync(pbxproj, "utf8")
      .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${next};`)
      .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`),
  );
  writeFileSync(
    gradle,
    readFileSync(gradle, "utf8")
      .replace(/versionCode \d+/, `versionCode ${buildNumber}`)
      .replace(/versionName "[^"]*"/, `versionName "${next}"`),
  );
  updated.push(pbxproj, gradle);
}

// The native app (`native/`) keeps its version in one small file per platform
// rather than inside the Xcode project or Gradle script, so this is a plain
// key=value rewrite that can't land in the wrong build configuration.
const nativeVersions = [
  {
    file: join(ROOT, "native/ios/Config/Version.xcconfig"),
    rewrite: (s) =>
      s
        .replace(/^MARKETING_VERSION = .*$/m, `MARKETING_VERSION = ${next}`)
        .replace(/^CURRENT_PROJECT_VERSION = .*$/m, `CURRENT_PROJECT_VERSION = ${buildNumber}`),
  },
  {
    file: join(ROOT, "native/android/version.properties"),
    rewrite: (s) =>
      s.replace(/^versionName=.*$/m, `versionName=${next}`).replace(/^versionCode=.*$/m, `versionCode=${buildNumber}`),
  },
];
for (const { file, rewrite } of nativeVersions) {
  let current;
  try {
    current = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  writeFileSync(file, rewrite(current));
  updated.push(file);
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
  updated.push(
    join(ROOT, "screenshots"),
    join(ROOT, "apps/rube.fyi/public/screenshots"),
    join(ROOT, "apps/rube.fyi/public/posters"),
  );
}

sh("git", ["add", ...updated]);
sh("git", ["commit", "-m", `v${next}`]);
sh("git", ["tag", "-a", `v${next}`, "-m", `v${next}`]);

console.error(`\nrelease: committed and tagged v${next}`);

// A release that only exists locally isn't one, and the manual push was easy
// to forget. `--follow-tags` sends the annotated tag along with the commit.
// The commit and tag are already made by this point, so a push failure is
// recoverable by hand rather than fatal to the release.
if (process.env.SKIP_PUSH === "1") {
  console.error(`release: SKIP_PUSH=1 — push it yourself with 'git push --follow-tags'`);
} else {
  console.error("release: pushing…");
  const push = spawnSync("git", ["push", "--follow-tags"], { cwd: ROOT, stdio: "inherit" });
  if (push.status !== 0) {
    die(
      `push failed — v${next} is committed and tagged locally.\n` +
        "  Retry with:  git push --follow-tags",
    );
  }
  console.error(`release: pushed v${next}`);
}
