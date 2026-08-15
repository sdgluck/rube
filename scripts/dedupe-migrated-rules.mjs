#!/usr/bin/env node
/**
 * One-off repair for rules duplicated by the Plex Smart migration provider.
 *
 * Before v0.16.2, that provider adopted *every* smart collection in Plex,
 * including the ones Tinkerbell generated itself. Running the migration
 * therefore minted a second rule for each generated collection: same name
 * (collections are named after their rule), equivalent config, disabled, and
 * never run. This deletes those copies.
 *
 * Dry run by default — prints what it would delete and changes nothing. Pass
 * `--apply` to write, which backs the database up first.
 *
 * A row is only deleted when all of the following hold, so a rule the user
 * actually made is never mistaken for a migration artefact:
 *
 *   • another rule shares its name exactly, and
 *   • that other rule is the one in use (enabled, or has run at least once), and
 *   • this row is disabled, has never run, and has never been tested.
 *
 * A name group where nothing has ever run is left alone and reported: there is
 * no evidence there which copy is the keeper, and that is the user's call.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

// better-sqlite3 is a dependency of @tinkerbell/db, and pnpm does not hoist it
// to the root node_modules — so resolve from the package that owns it rather
// than from wherever this script happens to have been dropped.
const REQUIRE_BASES = ["/app/packages/db/", join(process.cwd(), "packages/db/"), process.cwd() + "/"];
let Database = null;
for (const base of REQUIRE_BASES) {
  try {
    Database = createRequire(base)("better-sqlite3");
    break;
  } catch {}
}
if (!Database) {
  console.error(
    "Could not load better-sqlite3.\n" +
      "  Run this inside the Tinkerbell container, e.g.\n" +
      "    docker exec -w /app tinkerbell node /app/dedupe-migrated-rules.mjs",
  );
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const DB_PATH = join(process.env.DATA_DIR || "/config", "tinkerbell.db");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set DATA_DIR if yours lives elsewhere.`);
  process.exit(1);
}

const db = new Database(DB_PATH);

const rows = db
  .prepare(
    `SELECT id, name, type, enabled, created_at, last_run_at, last_test_at, registry_rule_slug
       FROM rules
      WHERE name IN (SELECT name FROM rules GROUP BY name HAVING COUNT(*) > 1)
      ORDER BY name, created_at`,
  )
  .all();

if (rows.length === 0) {
  console.log("No rules share a name — nothing to do.");
  process.exit(0);
}

const byName = new Map();
for (const r of rows) {
  if (!byName.has(r.name)) byName.set(r.name, []);
  byName.get(r.name).push(r);
}

const doomed = [];
const skipped = [];

for (const [name, group] of byName) {
  // "In use" is the evidence that this row is the original: the migrated copy
  // is written disabled and is never run by anything.
  const inUse = group.filter((r) => r.enabled === 1 || r.last_run_at != null);
  const inert = group.filter((r) => r.enabled === 0 && r.last_run_at == null && r.last_test_at == null);

  if (inUse.length === 0) {
    skipped.push({ name, reason: "no copy has ever run — can't tell which is the keeper", group });
    continue;
  }
  if (inert.length === 0) {
    skipped.push({ name, reason: "every copy is in use — these look deliberate", group });
    continue;
  }
  if (inert.length + inUse.length !== group.length) {
    skipped.push({ name, reason: "mixed state beyond the known pattern", group });
    continue;
  }
  for (const r of inert) doomed.push(r);
}

console.log(`Database: ${DB_PATH}`);
console.log(`${byName.size} name(s) with more than one rule.\n`);

if (doomed.length > 0) {
  console.log(`${APPLY ? "Deleting" : "Would delete"} ${doomed.length} duplicate rule(s):`);
  for (const r of doomed) {
    const from = r.registry_rule_slug ? ` [registry: ${r.registry_rule_slug}]` : "";
    console.log(`  • ${r.name}  (${r.type}, id=${r.id}, disabled, never run)${from}`);
  }
  console.log("");
}

if (skipped.length > 0) {
  console.log(`Left alone — ${skipped.length} name(s) needing your judgement:`);
  for (const s of skipped) {
    console.log(`  • "${s.name}" — ${s.reason}`);
    for (const r of s.group) {
      const state = r.enabled === 1 ? "enabled" : "disabled";
      const run = r.last_run_at ? `last run ${new Date(r.last_run_at).toISOString()}` : "never run";
      console.log(`      id=${r.id}  ${state}, ${run}`);
    }
  }
  console.log("");
}

if (doomed.length === 0) {
  console.log("Nothing matches the migration-duplicate pattern.");
  process.exit(0);
}

if (!APPLY) {
  console.log("Dry run — nothing was changed. Re-run with --apply to delete the rules listed above.");
  process.exit(0);
}

// Backed up through SQLite's own API rather than a file copy: the database
// runs in WAL mode, so copying just the .db file can capture a state that
// omits committed transactions still sitting in the -wal.
const backupPath = `${DB_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await db.backup(backupPath);
console.log(`Backup written to ${backupPath}`);

const del = db.prepare("DELETE FROM rules WHERE id = ?");
const run = db.transaction((victims) => {
  for (const r of victims) del.run(r.id);
});
run(doomed);

console.log(`Deleted ${doomed.length} rule(s).`);
console.log("Restart isn't required — the Rules page reads the database on each load.");
