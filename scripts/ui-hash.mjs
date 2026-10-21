/**
 * The definition of "a change that could move a pixel", and the hash over it.
 *
 * Shared deliberately: the capture writes this hash into
 * `screenshots/manifest.json`, and the pre-commit check recomputes it from the
 * index. Two copies of the pathspec that drifted apart would produce a hook
 * that fails forever with no way to diagnose it.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Scoped to the frontend on purpose.
 *
 * `domains/**` and `apps/server/**` can move pixels too — `/stats` renders
 * server uptime — but including them would demand a three-minute capture on
 * every backend commit, and the first time that happened on a one-line fix
 * people would reach for `--no-verify`, which also skips the type check. A hook
 * people route around is worse than a narrower one they keep.
 */
export const UI_PATHSPEC = [
  "apps/web/src",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "apps/web/public",
  "apps/portal/src",
  "apps/portal/index.html",
  "apps/portal/public",
  "apps/rube.fyi/harness",
  ":(exclude)apps/web/src/**/*.test.ts",
  ":(exclude)apps/web/src/**/*.test.tsx",
  ":(exclude)**/*.md",
];

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function digest(rows) {
  return createHash("sha256").update(rows.slice().sort().join("\n")).digest("hex");
}

/**
 * Hash the working tree — what the capture actually rendered.
 * `git hash-object` gives the same object id git would store, so this and
 * `uiHashFromIndex` agree whenever the tree is fully staged.
 *
 * `--others` counts files that exist but aren't tracked yet. Without it,
 * adding a new component and capturing would produce a hash that ignores the
 * new file, the hook would reject the commit once it was staged, and you'd
 * have to sit through a second capture to say the same thing.
 */
export function uiHashFromWorktree(repoRoot) {
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...UI_PATHSPEC], repoRoot)
    .split("\0")
    .filter(Boolean);
  if (files.length === 0) return digest([]);
  const shas = execFileSync("git", ["hash-object", "--stdin-paths"], {
    cwd: repoRoot,
    input: files.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .trim()
    .split("\n");
  return digest(files.map((f, i) => `${shas[i]}  ${f}`));
}

/**
 * Hash the index — what is about to be committed.
 * Returns null if any path is unmerged, where "what is about to be committed"
 * isn't yet a meaningful question.
 */
export function uiHashFromIndex(repoRoot) {
  const entries = git(["ls-files", "-s", "-z", "--", ...UI_PATHSPEC], repoRoot).split("\0").filter(Boolean);
  const rows = [];
  for (const entry of entries) {
    const [meta, path] = entry.split("\t");
    const [, sha, stage] = meta.split(" ");
    if (stage !== "0") return null;
    rows.push(`${sha}  ${path}`);
  }
  return digest(rows);
}
