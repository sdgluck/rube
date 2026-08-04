#!/usr/bin/env node
/**
 * Fail the build on a raw NUL byte in a source file.
 *
 * A literal 0x00 anywhere in a file makes `grep`, `ugrep` and `file(1)`
 * classify the whole file as binary and skip it — silently, reporting "no
 * match" rather than an error. One such byte in `domains/events/src/index.ts`
 * caused a false "this function doesn't exist" claim to be written into a plan
 * document and two separate investigations to reach the wrong conclusion.
 *
 * NUL is a legitimate delimiter (it can't collide with real data). Write it as
 * a `\u0000` escape and the file stays greppable with identical behaviour.
 *
 * Usage: node scripts/check-nul.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.json", "*.md"], {
  encoding: "buffer",
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const offenders = [];

for (const file of files) {
  const buf = readFileSync(file);
  const index = buf.indexOf(0);
  if (index === -1) continue;
  const line = buf.subarray(0, index).toString("utf8").split("\n").length;
  const count = buf.filter((b) => b === 0).length;
  offenders.push(`${file}:${line}: raw NUL byte${count > 1 ? ` (${count} in this file)` : ""}`);
}

if (offenders.length > 0) {
  console.error("Raw NUL bytes in source files:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    `\n${offenders.length} file(s). A literal NUL makes grep and file(1) treat the whole file as ` +
      `binary and skip it silently. Write the escape instead — \\u0000 — which is byte-identical at runtime.`,
  );
  process.exit(1);
}

console.log(`check-nul: ${files.length} file(s) scanned, no raw NUL bytes.`);
