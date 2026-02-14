#!/usr/bin/env node

import { execFile } from "node:child_process";

const THIRTY_MINUTES = 30 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

function timestamp() {
  return new Date().toISOString();
}

function buildArgs(command) {
  const args = ["index.mjs", command];

  if (process.env.PLEX_URL) {
    args.push("--url", process.env.PLEX_URL);
  }
  if (process.env.PLEX_TOKEN) {
    args.push("--token", process.env.PLEX_TOKEN);
  }
  if (process.env.SECTION) {
    args.push("--section", process.env.SECTION);
  }
  if ((command === "generate" || command === "because-you-watched") && process.env.LIMIT) {
    args.push("--limit", process.env.LIMIT);
  }
  if (command === "because-you-watched" && process.env.BYW_USER) {
    args.push("--user", process.env.BYW_USER);
  }
  if (process.env.VERBOSE === "true" || process.env.VERBOSE === "1") {
    args.push("--verbose");
  }

  return args;
}

function run(command) {
  const args = buildArgs(command);
  console.log(`[${timestamp()}] Running: node ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = execFile("node", args, {
      cwd: import.meta.dirname,
      env: process.env,
    });

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`[${timestamp()}] "${command}" exited with code ${code}`);
      } else {
        console.log(`[${timestamp()}] "${command}" completed successfully`);
      }
      resolve();
    });

    child.on("error", (err) => {
      console.error(`[${timestamp()}] "${command}" failed to start: ${err.message}`);
      resolve();
    });
  });
}

// ─── Startup ──────────────────────────────────────────────────────────────────

console.log(`[${timestamp()}] Tinkerbell scheduler starting`);
console.log(`  PLEX_URL:  ${process.env.PLEX_URL || "(default)"}`);
console.log(`  SECTION:   ${process.env.SECTION || "(all)"}`);
console.log(`  LIMIT:     ${process.env.LIMIT || "(default)"}`);
console.log(`  BYW_USER:  ${process.env.BYW_USER || "(all)"}`);
console.log(`  VERBOSE:   ${process.env.VERBOSE || "false"}`);
console.log(`  Generate interval:             24h`);
console.log(`  Because-you-watched interval:  24h`);
console.log(`  Shuffle interval:              30m\n`);

// Run all commands on startup
await run("generate");
await run("because-you-watched");
await run("shuffle");

// Schedule recurring runs
setInterval(() => run("generate"), TWENTY_FOUR_HOURS);
setInterval(() => run("because-you-watched"), TWENTY_FOUR_HOURS);
setInterval(() => run("shuffle"), THIRTY_MINUTES);
