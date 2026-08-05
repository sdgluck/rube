#!/usr/bin/env node
/**
 * Rejects a commit that changes the UI without regenerating the screenshots.
 *
 * `screenshots/` exists so a reviewer — human or otherwise — is always looking
 * at what the app currently renders. That only holds if the images move with
 * the code, and nothing else in this repo enforces it: there is no CI.
 *
 * Runs AFTER lint-staged in .husky/pre-commit, and the order is load-bearing.
 * lint-staged runs oxfmt and re-stages the formatted result, which changes the
 * very blobs this hashes. Checking first would record a hash of unformatted
 * content, and the *next* commit would fail for no visible reason.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { UI_PATHSPEC, uiHashFromIndex } from "./ui-hash.mjs";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitQuiet = (args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};

function fail(message) {
  process.stderr.write(`\ncheck-screenshots: ${message}\n\n`);
  process.exit(1);
}

// ── Escape hatches ──────────────────────────────────────────────────────────
// Named, so it shows up in the failure message. Without one, the reflex is
// `--no-verify`, which also skips lint and the type check.
if (process.env.SKIP_SCREENSHOT_CHECK === "1") process.exit(0);
if (gitQuiet(["config", "--bool", "tinkerbell.skipScreenshotCheck"])?.trim() === "true") process.exit(0);

// ── Operations where the index isn't the author's intent ────────────────────
// A conflicted merge holds a tree that matches neither parent's manifest.
// Resolve state files through git so linked worktrees work.
for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
  const path = gitQuiet(["rev-parse", "--git-path", name])?.trim();
  if (path && existsSync(path)) process.exit(0);
}

const head = gitQuiet(["rev-parse", "--verify", "-q", "HEAD"])
  ? "HEAD"
  : "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // the empty tree, for the first commit

// ── Did this commit touch the UI at all? ────────────────────────────────────
const staged = git(["diff", "--cached", "--name-only", "-z", head, "--", ...UI_PATHSPEC])
  .split("\0")
  .filter(Boolean);
if (staged.length === 0) process.exit(0);

// ── Compare ─────────────────────────────────────────────────────────────────
const actual = uiHashFromIndex(repoRoot);
if (actual === null) process.exit(0); // unmerged path; nothing meaningful to check

// Prefer the staged manifest, so the commit that regenerates both passes.
const raw =
  gitQuiet(["cat-file", "-p", ":screenshots/manifest.json"]) ??
  gitQuiet(["cat-file", "-p", `${head}:screenshots/manifest.json`]);
if (raw === null) process.exit(0); // suite not adopted yet

let manifest;
try {
  manifest = JSON.parse(raw);
} catch {
  fail("screenshots/manifest.json is not valid JSON.");
}

if (manifest.uiHash === actual) process.exit(0);

const shown = staged.slice(0, 6);
const more = staged.length - shown.length;
const unstaged = git(["diff", "--name-only", "--", ...UI_PATHSPEC]).split("\n").filter(Boolean);

fail(
  [
    "screenshots are stale.",
    "",
    `  ${staged.length} UI file${staged.length === 1 ? "" : "s"} staged:`,
    ...shown.map((f) => `    ${f}`),
    ...(more > 0 ? [`    …and ${more} more`] : []),
    "",
    unstaged.length > 0
      ? "  Note: you also have unstaged UI changes. The capture reads your working\n" +
        "  tree, so regenerate only once everything you intend to commit is staged."
      : "",
    "  Regenerate:  pnpm screenshots && git add screenshots",
    "  Skip once:   SKIP_SCREENSHOT_CHECK=1 git commit …",
  ]
    .filter((line) => line !== "")
    .join("\n"),
);
