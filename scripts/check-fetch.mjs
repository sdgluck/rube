#!/usr/bin/env node
/**
 * Fail the build on a `fetch()` call with no deadline.
 *
 * A request with no timeout is the single easiest way to wedge the job queue:
 * the run never terminates, its `job_runs` row stays `running` forever, the
 * "already running" guard never opens, and — because the queue is serialised —
 * nothing else runs either. The container healthcheck still returns 200, so
 * nothing alerts. Only a restart clears it.
 *
 * A call passes if, within a short window after it, it either:
 *   - passes an `AbortSignal.timeout(...)`, or
 *   - passes a `signal` that a comment/variable ties to a timeout, or
 *   - lives in `packages/http` (which *is* the timeout implementation).
 *
 * The check is deliberately textual rather than AST-based: it has to be
 * trivially obvious why it fired, and the fix is always the same one line.
 *
 * Usage: node scripts/check-fetch.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SEARCH_DIRS = ["clients/", "packages/", "domains/", "apps/server/"];

/**
 * Files exempt from the rule, each with a reason. Add to this only when the
 * absence of a timeout is a deliberate, explained decision.
 */
const ALLOWLIST = new Map([
  ["packages/http/src/index.ts", "this is the wrapper that applies the timeout"],
  [
    "clients/plex/src/streaming.ts",
    "streams a transcoded video body; a wall-clock deadline would cut off long playbacks. Used only by the stress-test harness, which bounds its own runtime.",
  ],
]);

/** How many lines after `fetch(` to look in for the signal. */
const WINDOW = 12;

const files = execFileSync("git", ["ls-files", "-z", "*.ts", "*.tsx"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((f) => SEARCH_DIRS.some((d) => f.startsWith(d)));

const offenders = [];

for (const file of files) {
  if (ALLOWLIST.has(file)) continue;
  const lines = readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Prose about fetch is not a call to fetch.
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
    // Bare `fetch(` — not `.fetch(`, `prefetch`, `refetch`, or a definition.
    if (!/(^|[^.\w])fetch\s*\(/.test(lines[i])) continue;
    if (/\bfunction\s+\w*fetch/i.test(lines[i])) continue;

    const window = lines.slice(i, i + WINDOW).join("\n");
    // Stop at the end of this call so we can't borrow a later call's signal.
    const end = window.indexOf("});");
    const call = end === -1 ? window : window.slice(0, end + 3);

    if (/AbortSignal\.timeout|timeoutMs|signal:\s*\w*[Tt]imeout/.test(call)) continue;
    // A signal built elsewhere, where the name says it carries a deadline.
    if (/signal:\s*(deadline|withTimeout)/.test(call)) continue;

    offenders.push(`${file}:${i + 1}: ${lines[i].trim()}`);
  }
}

if (offenders.length > 0) {
  console.error("fetch() calls with no deadline:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    `\n${offenders.length} offender(s). Give each an AbortSignal.timeout(), route it through ` +
      `@tinkerbell/http (which takes timeoutMs), or add it to ALLOWLIST in scripts/check-fetch.mjs ` +
      `with a reason.`,
  );
  process.exit(1);
}

console.log(`check-fetch: ${files.length} file(s) scanned, every fetch() has a deadline.`);
