---
name: release
description: Cut a new Rube release — version bump, AI-written CHANGELOG entry, screenshot regeneration, commit, tag and push. Use when asked to "cut a release", "ship a version", "release patch/minor/major", or when a release run has failed partway and left the tree dirty.
---

# Cutting a release

Everything is done by `scripts/release.mjs`. Do not bump versions, write the
CHANGELOG entry, or tag by hand — the script does all of it in one pass, and
half-doing it by hand is how a release ends up with mismatched package versions.

```sh
pnpm release <patch|minor|major>
```

## Before running

1. **Working tree must be clean.** The script refuses otherwise. Commit or stash first.
2. **Be on `master` and up to date** — the tag is cut from HEAD and pushed.
3. **Docker must be running.** Screenshots are captured inside the Playwright
   image (`scripts/capture-docker.mjs`); a dead Docker daemon fails the run
   _after_ the version bump is already written.
4. **Pick the bump from the commits since the last tag.** `git log $(git describe --tags --abbrev=0)..HEAD --no-merges --oneline`.
   Only `fix`/chore commits → `patch`. Any `feat` → `minor`. This is 0.x beta
   software; `major` is a deliberate call, not an automatic one for breaking changes.

## What the script does, in order

1. Computes the next version from the root `package.json`.
2. Collects commit **subjects and bodies** since the last tag and pipes them to
   `claude -p --model claude-opus-5-5` to write Keep a Changelog sections.
3. Validates the output: must have `### ` sections, must have bullets, and no
   bullet shorter than 8 words. Any of those fail the release before writing.
4. Prints the entry, then inserts it under `## [Unreleased]` in `CHANGELOG.md`.
5. Bumps `version` in the root and in every `package.json` under `apps/`,
   `packages/`, `clients/`, `domains/`.
6. Regenerates the whole screenshot suite in Docker (this is the slow part —
   minutes). It runs _after_ the bump on purpose: the sidebar renders a version
   pill, so capturing first bakes the old version into ~50 images.
7. `git commit -m "vX.Y.Z"`, `git tag -a vX.Y.Z`, `git push --follow-tags`.

## Escape hatches

| Env                   | Effect                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG_DRY_RUN=1` | Print the generated entry and stop. Nothing written. Use this to preview the changelog before committing to a release.        |
| `SKIP_SCREENSHOTS=1`  | Ship whatever is in `screenshots/`. They will be stale — only for a release with no UI change, or when Docker is unavailable. |
| `SKIP_PUSH=1`         | Commit and tag locally; push yourself with `git push --follow-tags`.                                                          |

## After the tag lands

Pushing a `v*` tag triggers `.github/workflows/docker-publish.yml`, which builds
`linux/amd64` and `linux/arm64` on native runners and publishes to GHCR under
`latest` plus the semver tags. (Every push to `master` publishes `edge`
separately.) `.github/workflows/site-deploy.yml` redeploys rube.fyi,
which also serves the rule registry.

Check it with `gh run list --workflow=docker-publish.yml -L 3`.

## Recovering from a failed run

The script writes files before it commits, so a mid-run failure leaves a dirty
tree with the bump and CHANGELOG entry already in place.

- **Screenshot capture failed** → `git checkout -- .` to undo, or rerun with
  `SKIP_SCREENSHOTS=1`.
- **Claude summarisation failed / bullets too terse** → nothing was written yet.
  Rerun. If it keeps producing weak bullets, write the `CHANGELOG.md` entry by
  hand under a `## [X.Y.Z] - YYYY-MM-DD` heading and rerun; the script still
  regenerates its own entry, so instead prefer rerunning until the summary is
  good, then edit the committed entry and amend.
- **Claude timed out after 3min** → usually a global hook in
  `~/.claude/settings.json` stalling the subprocess.
- **Push failed** → the commit and tag exist locally. Just
  `git push --follow-tags`.
- **Tree dirty with a bump but no `vX.Y.Z` commit** → an earlier run died. Decide
  between finishing by hand (`git add -A && git commit -m vX.Y.Z && git tag -a vX.Y.Z -m vX.Y.Z`)
  and resetting with `git checkout -- .` before rerunning. Never rerun `pnpm
release` on top of an existing bump — it would bump twice.
