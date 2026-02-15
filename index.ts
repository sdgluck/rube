#!/usr/bin/env node

/**
 * tinkerbell — Manage your Plex homepage hubs.
 *
 * Usage:
 *   tinkerbell <command> [options]
 *
 * Commands:
 *   shuffle              Shuffle the hub ordering on your Plex homepage
 *   generate             Use AI to create curated collections from library items
 *   because-you-watched  Create "Because you watched X" collections from watch history
 *   cleanup              Delete tinkerbell-generated collections
 *   sync-collections     Sync all Plex collections to local database
 *   label                Configure per-user sharing restrictions via labels
 *
 * Global options:
 *   --url, -u          Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
 *   --token, -t        Plex auth token           (env: PLEX_TOKEN)
 *   --verbose, -v      Show detailed output      (default: false)
 *   --help, -h         Show this help message
 *
 * Environment variables:
 *   PLEX_URL           Base URL of your Plex server
 *   PLEX_TOKEN         Your Plex authentication token
 */

import { parseArgs } from "node:util";

// ─── CLI argument parsing ──────────────────────────────────────────────────────

const { values: globalArgs, positionals } = parseArgs({
  options: {
    url: { type: "string", short: "u" },
    token: { type: "string", short: "t" },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: false,
  allowPositionals: true,
});

const command = positionals[0];

function printUsage(): void {
  console.log(
    `
tinkerbell — Manage your Plex homepage hubs.

Usage:
  tinkerbell <command> [options]

Commands:
  shuffle              Shuffle the hub ordering on your Plex homepage
  generate             Use AI to create curated collections from library items
  because-you-watched  Create "Because you watched X" collections from watch history
  cleanup              Delete tinkerbell-generated collections
  sync-collections     Sync all Plex collections to local database
  label                Configure per-user sharing restrictions via labels

Global options:
  --url, -u          Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t        Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v      Show detailed output      (default: false)
  --help, -h         Show this help message

Run "tinkerbell <command> --help" for command-specific help.
    `.trim(),
  );
}

function printShuffleUsage(): void {
  console.log(
    `
tinkerbell shuffle — Shuffle the hub ordering on your Plex homepage.

Usage:
  tinkerbell shuffle [options]

Options:
  --sections, -s   Comma-separated section names/IDs  (omit to shuffle ALL sections)
  --dry-run, -d    Preview without applying  (default: false)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Examples:
  PLEX_TOKEN=abc123 tinkerbell shuffle
  tinkerbell shuffle --url http://192.168.1.10:32400 --token abc123
  tinkerbell shuffle --token abc123 --sections Movies --dry-run
    `.trim(),
  );
}

function printGenerateUsage(): void {
  console.log(
    `
tinkerbell generate — Use AI to create curated Plex collections.

Generates themed collections from your library items using Claude AI,
pins them to your homepage, and cleans up previously generated ones.

Usage:
  tinkerbell generate [options]

Options:
  --sections, -s   Comma-separated section names/IDs  (omit to generate for ALL sections)
  --limit, -l      Max collections per section (default: 8)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Environment variables:
  ANTHROPIC_API_KEY   Your Anthropic API key (required)

Examples:
  PLEX_TOKEN=abc ANTHROPIC_API_KEY=sk-ant-... tinkerbell generate
  tinkerbell generate --token abc --sections Movies
    `.trim(),
  );
}

function printCleanupUsage(): void {
  console.log(
    `
tinkerbell cleanup — Delete tinkerbell-generated collections.

Removes collections previously created by "tinkerbell generate".
Use --all to remove ALL collections in matched sections (useful if broken
collections are preventing Plex from loading).

Usage:
  tinkerbell cleanup [options]

Options:
  --sections, -s   Comma-separated section names/IDs  (omit to clean ALL sections)
  --from, -f       Delete collections added on or after this date (YYYY-MM-DD)
  --all, -a        Delete ALL collections, not just tinkerbell ones

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Examples:
  tinkerbell cleanup --token abc
  tinkerbell cleanup --token abc --sections Movies --all
    `.trim(),
  );
}

function printBecauseYouWatchedUsage(): void {
  console.log(
    `
tinkerbell because-you-watched — Create "Because you watched X" collections.

Analyses your watch history and creates personalised recommendation
collections on your Plex homepage, similar to Netflix/Spotify.

Usage:
  tinkerbell because-you-watched [options]

Options:
  --user, -U       Plex account username    (omit for all users)
  --sections, -s   Comma-separated section names/IDs  (omit to process ALL sections)
  --limit, -l      Number of watched items  (default: 10, max: 20)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Environment variables:
  ANTHROPIC_API_KEY   Your Anthropic API key (required)

Examples:
  PLEX_TOKEN=abc ANTHROPIC_API_KEY=sk-ant-... tinkerbell because-you-watched
  tinkerbell because-you-watched --token abc --user John --limit 5
  tinkerbell because-you-watched --token abc --sections Movies
    `.trim(),
  );
}

if (globalArgs.help && !command) {
  printUsage();
  process.exit(0);
}

if (!command) {
  printUsage();
  process.exit(1);
}

// ─── Command dispatch ──────────────────────────────────────────────────────────

if (command === "shuffle") {
  const { values: args } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      token: { type: "string", short: "t" },
      sections: { type: "string", short: "s" },
      "dry-run": { type: "boolean", short: "d", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (args.help) {
    printShuffleUsage();
    process.exit(0);
  }

  const { default: run } = await import("./commands/shuffle.ts");
  await run(args).catch((err: Error) => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  });
} else if (command === "generate") {
  const { values: args } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      token: { type: "string", short: "t" },
      sections: { type: "string", short: "s" },
      limit: { type: "string", short: "l" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (args.help) {
    printGenerateUsage();
    process.exit(0);
  }

  const { default: run } = await import("./commands/generate.ts");
  await run(args).catch((err: Error) => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  });
} else if (command === "cleanup") {
  const { values: args } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      token: { type: "string", short: "t" },
      sections: { type: "string", short: "s" },
      from: { type: "string", short: "f" },
      all: { type: "boolean", short: "a", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (args.help) {
    printCleanupUsage();
    process.exit(0);
  }

  const { default: run } = await import("./commands/cleanup.ts");
  await run(args).catch((err: Error) => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  });
} else if (command === "because-you-watched") {
  const { values: args } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      token: { type: "string", short: "t" },
      user: { type: "string", short: "U" },
      sections: { type: "string", short: "s" },
      limit: { type: "string", short: "l" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (args.help) {
    printBecauseYouWatchedUsage();
    process.exit(0);
  }

  const { default: run } = await import("./commands/because-you-watched.ts");
  await run(args).catch((err: Error) => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  });
} else if (command === "sync-collections") {
  const { values: args } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      token: { type: "string", short: "t" },
      sections: { type: "string", short: "s" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (args.help) {
    console.log(
      `
tinkerbell sync-collections — Sync all Plex collections to local database.

Usage:
  tinkerbell sync-collections [options]

Options:
  --sections, -s   Comma-separated section names/IDs  (omit to sync ALL sections)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Examples:
  tinkerbell sync-collections --token abc123
  tinkerbell sync-collections --token abc123 --sections Movies
      `.trim(),
    );
    process.exit(0);
  }

  const { default: run } = await import("./commands/sync-collections.ts");
  await run(args).catch((err: Error) => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  });
} else if (command === "label") {
  const { values: args } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      token: { type: "string", short: "t" },
      sections: { type: "string", short: "s" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (args.help) {
    console.log(
      `
tinkerbell label — Configure per-user sharing restrictions via labels.

Sets Plex sharing restrictions so each user only sees collections
labelled "Tinkerbell" and "User:{username}". Run once during setup
or whenever users are added/removed.

Usage:
  tinkerbell label [options]

Options:
  --sections, -s   Comma-separated section names/IDs  (omit for ALL)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Examples:
  tinkerbell label --token abc123
  tinkerbell label --token abc123 --verbose
      `.trim(),
    );
    process.exit(0);
  }

  const { default: run } = await import("./commands/label.ts");
  await run(args).catch((err: Error) => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "tinkerbell --help" for available commands.');
  process.exit(1);
}
