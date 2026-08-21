// Everything CI checks, in under a minute.
//
// All four run at once, and the suite is killed the moment a cheap check fails.
// That combination is the point: overlapped, format, lint and typecheck finish
// entirely inside the suite's runtime and cost nothing (45.6s for all four,
// against 49.5s for cheap-checks-then-suite), but a formatting slip still comes
// back in ~10s instead of after a full test run.
//
// The thing that actually made this fast was not the scheduling — it was
// dropping `pnpm run <script>` in favour of spawning the tools directly. Each
// `pnpm run` cost about a second of startup, and with the checks overlapped
// they inflated each other to ~14s apiece; the same three now take 2–10s.
//
// Output is buffered per check and printed at the end, because four interleaved
// live streams are unreadable.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Kept in step with the `lint` and `format:check` scripts in package.json —
// those stay the documented entrypoints and are what CI runs. Change one,
// change the other.
const SOURCES = "'*.ts' '*.tsx' '*.js' '*.jsx' '*.json' '*.css' '*.html' '*.md' ':!:packages/db/drizzle/**'";
const FORMAT_CHECK = `git ls-files -z ${SOURCES} | xargs -0 oxfmt --check`;
const LINT = [
  "git ls-files -z '*.ts' '*.tsx' | xargs -0 oxlint",
  "git ls-files -z '*.css' | xargs -0 stylelint",
  "node scripts/check-fetch.mjs",
  "node scripts/check-nul.mjs",
].join(" && ");

const CHECKS = [
  { name: "format", cmd: FORMAT_CHECK },
  { name: "lint", cmd: LINT },
  { name: "typecheck", cmd: "node scripts/typecheck.mjs" },
  // The long pole, and the only one worth abandoning early.
  { name: "test", cmd: "node scripts/test.mjs", long: true },
];

const only = process.argv.slice(2);
const selected = only.length ? CHECKS.filter((c) => only.includes(c.name)) : CHECKS;

if (only.length && selected.length !== only.length) {
  const unknown = only.filter((n) => !CHECKS.some((c) => c.name === n));
  console.error(`unknown check(s): ${unknown.join(", ")}`);
  console.error(`known checks: ${CHECKS.map((c) => c.name).join(", ")}`);
  process.exit(2);
}

const running = new Set();

function run(check) {
  const started = Date.now();
  // `detached` puts the child in its own process group so one kill takes the
  // shell, `node scripts/test.mjs`, and the twenty test processes under it —
  // killing just the shell would leave the suite running in the background.
  const child = spawn(check.cmd, {
    cwd: root,
    shell: true,
    detached: true,
    // `oxfmt`/`oxlint`/`stylelint` resolve the way they would in a pnpm script.
    env: { ...process.env, PATH: `${path.join(root, "node_modules", ".bin")}:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);

  const result = new Promise((resolve) => {
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const done = (code, extra = {}) => {
      running.delete(child);
      resolve({ ...check, code, output, ms: Date.now() - started, ...extra });
    };
    child.on("error", (err) => done(1, { output: String(err) }));
    child.on("close", (code) => done(code ?? 1));
  });

  return { child, result };
}

function kill(child) {
  // The group, not the process. ESRCH just means it finished on its own.
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

const cleanup = () => {
  for (const child of running) kill(child);
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const wall = Date.now();
const started = selected.map((c) => ({ ...c, ...run(c) }));

const cheap = started.filter((s) => !s.long);
const long = started.filter((s) => s.long);

// The *first* cheap failure abandons the suite, rather than waiting for all
// three to report — there is nothing to learn from a test run whose input is
// already known to be broken. `abandoned` rather than `failed`: it never got
// to say.
const abandoned = new Set();
for (const c of cheap) {
  c.result.then((r) => {
    if (r.code === 0) return;
    for (const s of long) {
      if (abandoned.has(s.name)) continue;
      abandoned.add(s.name);
      kill(s.child);
    }
  });
}

const results = await Promise.all(started.map((s) => s.result));
const elapsed = Date.now() - wall;

for (const { name, code, output } of results) {
  // A passing check has nothing worth reading; only show failures' output.
  if (code !== 0 && !abandoned.has(name)) console.log(`\n──── ${name} ────\n${output.trimEnd()}\n`);
}

for (const { name, code, ms } of results) {
  const status = abandoned.has(name) ? "--" : code === 0 ? "ok" : "FAIL";
  const note = abandoned.has(name) ? " (abandoned — fix the above first)" : "";
  console.log(`${status.padEnd(4)} ${name.padEnd(10)} ${(ms / 1000).toFixed(1)}s${note}`);
}

const failed = results.filter((r) => r.code !== 0 && !abandoned.has(r.name));
console.log(`${failed.length === 0 && abandoned.size === 0 ? "ok" : "FAIL"}   ${"total".padEnd(10)} ${(elapsed / 1000).toFixed(1)}s`);

process.exit(failed.length > 0 || abandoned.size > 0 ? 1 : 0);
