#!/usr/bin/env node

import { execFile } from "node:child_process";
import { getConfig } from "./config.ts";

const THIRTY_MINUTES = 30 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const plexUrl = getConfig("global_plex_url") || process.env.PLEX_URL;
const plexToken = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
const sections = getConfig("scheduler_sections") || process.env.SECTION;
const limit = getConfig("scheduler_limit") || process.env.LIMIT;
const bywUser = getConfig("byw_plex_user") || process.env.BYW_USER;
const verbose = getConfig("scheduler_verbose") || process.env.VERBOSE;

function timestamp(): string {
  return new Date().toISOString();
}

function buildArgs(command: string): string[] {
  const args = ["index.ts", command];

  if (plexUrl) {
    args.push("--url", plexUrl);
  }
  if (plexToken) {
    args.push("--token", plexToken);
  }
  if (sections) {
    const val = Array.isArray(sections) ? sections.join(",") : sections;
    args.push("--sections", val);
  }
  if ((command === "generate" || command === "because-you-watched") && limit) {
    args.push("--limit", limit);
  }
  if (command === "because-you-watched" && bywUser) {
    args.push("--user", bywUser);
  }
  if (verbose === "true" || verbose === "1") {
    args.push("--verbose");
  }

  return args;
}

function run(command: string): Promise<void> {
  const args = buildArgs(command);
  console.log(`[${timestamp()}] Running: node ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = execFile("node", args, {
      cwd: import.meta.dirname,
      env: process.env,
    });

    child.stdout!.pipe(process.stdout);
    child.stderr!.pipe(process.stderr);

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
console.log(`  PLEX_URL:  ${plexUrl || "(default)"}`);
console.log(`  SECTIONS:  ${sections ? (Array.isArray(sections) ? sections.join(",") : sections) : "(all)"}`);
console.log(`  LIMIT:     ${limit || "(default)"}`);
console.log(`  BYW_USER:  ${bywUser || "(all)"}`);
console.log(`  VERBOSE:   ${verbose || "false"}`);
console.log(`  Sync-collections interval:     24h`);
console.log(`  Generate interval:             24h`);
console.log(`  Because-you-watched interval:  24h`);
console.log(`  Shuffle interval:              30m\n`);

// Run all commands on startup (sync collections first so data is fresh)
await run("sync-collections");
await run("generate");
await run("because-you-watched");
await run("shuffle");

// Schedule recurring runs
setInterval(() => run("sync-collections"), TWENTY_FOUR_HOURS);
setInterval(() => run("generate"), TWENTY_FOUR_HOURS);
setInterval(() => run("because-you-watched"), TWENTY_FOUR_HOURS);
setInterval(() => run("shuffle"), THIRTY_MINUTES);
