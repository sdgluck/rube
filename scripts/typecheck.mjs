// Typechecks the repo as four tsc programs instead of one per workspace package.
//
// Packages resolve each other through `exports: "./src/index.ts"` — raw source,
// no build step — so a per-package `tsc` re-checks its whole transitive source
// graph from scratch. With 39 packages that meant the same backend files were
// checked dozens of times over: 122s wall, and packages with a single source
// file were taking 40s. The 36 NodeNext packages share an identical config, so
// they collapse into one program (tsconfig.node.json) that checks each file
// once. The three Vite apps stay separate — each defines its own `#/*` subpath
// imports, which would collide if merged.
//
// Pass one or more program names to check only those, e.g.
// `pnpm typecheck web portal`.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROGRAMS = [
  { name: "node", cwd: ".", args: ["-p", "tsconfig.node.json"] },
  { name: "web", cwd: "apps/web", args: [] },
  { name: "portal", cwd: "apps/portal", args: [] },
  { name: "rube.fyi", cwd: "apps/rube.fyi", args: [] },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const selected = only.length ? PROGRAMS.filter((p) => only.includes(p.name)) : PROGRAMS;

if (only.length && selected.length !== only.length) {
  const known = PROGRAMS.map((p) => p.name).join(", ");
  console.error(`unknown program(s): ${only.filter((n) => !PROGRAMS.some((p) => p.name === n)).join(", ")}`);
  console.error(`known programs: ${known}`);
  process.exit(2);
}

const bin = path.join(root, "node_modules", ".bin", "tsc");

function run({ name, cwd, args }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, args, {
      cwd: path.join(root, cwd),
      // tsc writes diagnostics to stdout, not stderr.
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => resolve({ name, code: 1, output: String(err), ms: Date.now() - started }));
    child.on("close", (code) => resolve({ name, code: code ?? 1, output, ms: Date.now() - started }));
  });
}

const results = await Promise.all(selected.map(run));

for (const { name, code, output, ms } of results) {
  const status = code === 0 ? "ok" : "FAIL";
  console.log(`${status.padEnd(4)} ${name.padEnd(15)} ${ms}ms`);
  if (output.trim()) console.log(output.trimEnd() + "\n");
}

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
