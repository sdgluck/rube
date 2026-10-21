/**
 * The schema itself, and the way it gets onto a disk.
 *
 * `createTestDb()` applies every migration on every call, so ~40 test files
 * already prove that a *fresh* database migrates cleanly. What none of them
 * touch:
 *
 * - **Applying twice.** An upgrade runs the migrator against a database that is
 *   already current. If that were not a no-op, every restart would be a
 *   coin flip.
 * - **The legacy bootstrap.** `bootstrapPushedDatabase` seeds
 *   `__drizzle_migrations` for installs provisioned by `drizzle-kit push`
 *   before that table existed. Get the hash convention wrong and drizzle either
 *   re-runs `0000` (crash on first `CREATE TABLE`) or, worse, believes a
 *   migration has already run and **skips it silently**. That is the one
 *   failure in this package that corrupts somebody else's install rather than
 *   failing loudly on ours.
 * - **The cascades.** Eight foreign keys declare `onDelete: "cascade"`, and
 *   deleting a rule is supposed to take its run history, ledger rows, cleanup
 *   candidates and schedules with it. Nothing asserted that — and a cascade
 *   only works if `foreign_keys = ON`, which is a per-connection pragma that
 *   both the app and the migrator have to set independently.
 * - **The FTS5 triggers.** `0004_fts_search.sql` is the only hand-written
 *   migration with virtual tables and triggers, it is invisible to drizzle's
 *   snapshots (so nothing regenerates or diffs it), and it is what the search
 *   page reads. A trigger that stops firing means search quietly returns stale
 *   rows for ever.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { bootstrapPushedDatabase, BOOTSTRAP_BASELINE_IDX } from "./bootstrap.ts";
import { createTestDb, type TestDb } from "./test-db.ts";
import { collections, jobCheckpoints, jobRuns, jobs, mediaItems, ruleRunChanges, ruleRuns, rules } from "./schema.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

const journal: Journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));

/** A raw sqlite handle in its own temp dir. */
function rawDb(): { sqlite: Database.Database; dir: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "rube-migrate-"));
  const sqlite = new Database(join(dir, "rube.db"));
  sqlite.pragma("foreign_keys = ON");
  return {
    sqlite,
    dir,
    dispose() {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Recreate the schema of the push-managed era: every migration up to and
 * including the baseline, run directly, leaving no `__drizzle_migrations`.
 *
 * drizzle separates statements with `--> statement-breakpoint`, so the files
 * cannot simply be `exec`ed whole in all cases; splitting on the marker is what
 * drizzle's own migrator does.
 */
function applyThroughBaseline(sqlite: Database.Database): void {
  for (const entry of journal.entries.filter((e) => e.idx <= BOOTSTRAP_BASELINE_IDX)) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

function tableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
}

describe("the journal", () => {
  test("every entry has its SQL file on disk", () => {
    // A journal entry whose `.sql` is missing fails at migrate time on a user's
    // machine, not here — unless something checks.
    for (const entry of journal.entries) {
      assert.doesNotThrow(
        () => readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8"),
        `${entry.tag}.sql is in the journal but not on disk`,
      );
    }
  });

  test("every SQL file on disk is in the journal", () => {
    // The other direction: a generated migration that never got committed to
    // the journal simply never runs, and the column it adds is missing in
    // production while being present in every dev database.
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const inJournal = journal.entries.map((e) => e.tag).sort();
    assert.deepEqual(onDisk, inJournal);
  });

  test("indices are contiguous and start at zero", () => {
    assert.deepEqual(
      journal.entries.map((e) => e.idx),
      journal.entries.map((_, i) => i),
    );
  });

  test("entries are ordered by their timestamp", () => {
    // drizzle applies in journal order; a `when` that goes backwards is a sign
    // two branches generated migrations independently and were merged without
    // re-ordering.
    const times = journal.entries.map((e) => e.when);
    assert.deepEqual(
      [...times].sort((a, b) => a - b),
      times,
    );
  });

  test("the bootstrap baseline stayed closed", () => {
    // Raising this silently skips every migration up to the new number on a
    // legacy install. The window closed; the constant should never move.
    assert.equal(BOOTSTRAP_BASELINE_IDX, 5);
    assert.ok(journal.entries.length > BOOTSTRAP_BASELINE_IDX + 1, "there are migrations beyond the baseline");
  });
});

describe("applying migrations", () => {
  test("a fresh database migrates from nothing", () => {
    const { sqlite, dispose } = rawDb();
    try {
      assert.deepEqual(tableNames(sqlite), []);
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });

      const tables = tableNames(sqlite);
      assert.ok(tables.includes("rules"));
      assert.ok(tables.includes("config"));
      assert.ok(tables.includes("__drizzle_migrations"));
    } finally {
      dispose();
    }
  });

  test("applying twice is a no-op", () => {
    const { sqlite, dispose } = rawDb();
    try {
      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      const before = tableNames(sqlite);
      const appliedBefore = sqlite
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations")
        .get()!.n;

      assert.doesNotThrow(() => migrate(db, { migrationsFolder: MIGRATIONS_DIR }));

      assert.deepEqual(tableNames(sqlite), before);
      assert.equal(
        sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations").get()!.n,
        appliedBefore,
        "the second run recorded nothing new",
      );
    } finally {
      dispose();
    }
  });

  test("every migration is recorded", () => {
    const { sqlite, dispose } = rawDb();
    try {
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });
      const applied = sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations").get()!.n;
      assert.equal(applied, journal.entries.length);
    } finally {
      dispose();
    }
  });

  test("data survives a re-run of the migrator", () => {
    // The upgrade path in one line: existing rows must still be there after the
    // migrator runs against an already-current database.
    const { sqlite, dispose } = rawDb();
    try {
      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      db.insert(rules).values({ id: "r1", name: "Keeps", type: "collection", createdAt: 1 }).run();

      migrate(db, { migrationsFolder: MIGRATIONS_DIR });

      assert.equal(db.select().from(rules).all().length, 1);
    } finally {
      dispose();
    }
  });
});

describe("the legacy push-managed bootstrap", () => {
  test("does nothing to a fresh database", () => {
    const { sqlite, dispose } = rawDb();
    try {
      assert.equal(bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR), 0);
      assert.equal(tableNames(sqlite).includes("__drizzle_migrations"), false, "no table was invented");
    } finally {
      dispose();
    }
  });

  test("does nothing to a database that has already been migrated", () => {
    const { sqlite, dispose } = rawDb();
    try {
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });
      const before = sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations").get()!.n;

      assert.equal(bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR), 0);

      assert.equal(
        sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations").get()!.n,
        before,
      );
    } finally {
      dispose();
    }
  });

  test("seeds the baseline for a push-provisioned database", () => {
    // The shape of a legacy install: user tables present, no migrations table.
    const { sqlite, dispose } = rawDb();
    try {
      sqlite.exec("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)");

      const count = bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR);

      assert.equal(count, BOOTSTRAP_BASELINE_IDX + 1, "everything up to and including the baseline");
      assert.equal(
        sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations").get()!.n,
        BOOTSTRAP_BASELINE_IDX + 1,
      );
    } finally {
      dispose();
    }
  });

  test("writes the hashes drizzle itself would have written", () => {
    // This is the assertion the whole file exists for. If the hash convention
    // diverges from drizzle's, the seeded rows match nothing, drizzle treats
    // every migration as pending, and `0000` re-runs against tables that are
    // already there.
    const { sqlite, dispose } = rawDb();
    try {
      sqlite.exec("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)");
      bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR);
      const seeded = sqlite
        .prepare<[], { hash: string }>("SELECT hash FROM __drizzle_migrations ORDER BY id")
        .all()
        .map((r) => r.hash);

      // Drizzle's own record, from a database it migrated itself.
      const reference = rawDb();
      try {
        migrate(drizzle(reference.sqlite), { migrationsFolder: MIGRATIONS_DIR });
        const theirs = reference.sqlite
          .prepare<[], { hash: string }>("SELECT hash FROM __drizzle_migrations ORDER BY id")
          .all()
          .map((r) => r.hash);

        assert.deepEqual(
          seeded,
          theirs.slice(0, seeded.length),
          "the bootstrap hashes must be byte-identical to drizzle's, in the same order",
        );
      } finally {
        reference.dispose();
      }
    } finally {
      dispose();
    }
  });

  test("a bootstrapped database then applies only what came after the baseline", () => {
    // The end-to-end legacy upgrade, and the reason this file exists.
    //
    // The legacy database is simulated by running the pre-baseline migrations
    // by hand and then throwing away the record that they ran — which is
    // exactly the state `drizzle-kit push` left behind: the schema of that era,
    // and no `__drizzle_migrations`. Seeding it with only a `config` table
    // would not do; the post-baseline migrations `ALTER` tables that a real
    // push-provisioned database already has, and the upgrade would fail for a
    // reason no user would ever hit.
    const { sqlite, dispose } = rawDb();
    try {
      applyThroughBaseline(sqlite);
      assert.equal(tableNames(sqlite).includes("__drizzle_migrations"), false, "the legacy state has no record");
      assert.ok(tableNames(sqlite).includes("config"), "but it does have the tables");

      const seeded = bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR);
      assert.equal(seeded, BOOTSTRAP_BASELINE_IDX + 1);

      // If the bootstrap were wrong, this is where it shows: either `0000`
      // re-runs and hits "table config already exists", or a post-baseline
      // migration is skipped and its column never appears.
      assert.doesNotThrow(() => migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR }));

      const tables = tableNames(sqlite);
      assert.ok(tables.includes("rules"));
      assert.ok(tables.includes("media_items_fts"), "the post-baseline migrations ran");
      assert.equal(
        sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM __drizzle_migrations").get()!.n,
        journal.entries.length,
        "and every migration is now accounted for",
      );
    } finally {
      dispose();
    }
  });

  test("a legacy upgrade keeps the data that was already there", () => {
    const { sqlite, dispose } = rawDb();
    try {
      applyThroughBaseline(sqlite);
      sqlite.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run("global_plex_url", "http://plex.local");

      bootstrapPushedDatabase(sqlite, MIGRATIONS_DIR);
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });

      const row = sqlite
        .prepare<[string], { value: string }>("SELECT value FROM config WHERE key = ?")
        .get("global_plex_url");
      assert.equal(row?.value, "http://plex.local");
    } finally {
      dispose();
    }
  });
});

describe("foreign keys", () => {
  let t: TestDb;
  before(() => {
    t = createTestDb();
  });
  after(() => t.dispose());

  test("the pragma is on for the app's own connection", () => {
    // A per-connection pragma. `migrate.ts` sets it, `index.ts` sets it, and a
    // cascade silently stops cascading if either stops.
    const [row] = t.db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
    assert.equal(row?.foreign_keys, 1);
  });

  test("every table that declares a cascade on rules.id actually cascades", () => {
    // Data-driven from the schema's own declarations rather than a hand-picked
    // pair, so a table added with `onDelete: "cascade"` is covered the day it
    // lands. A rule delete that leaves rows behind means the next rule to reuse
    // that id inherits a stranger's history.
    const { db } = t;
    const CASCADING = [
      "rule_history",
      "rule_collection_members",
      "rule_run_changes",
      "rule_runs",
      "collection_artwork",
      "cleanup_candidates",
      "managed_playlists",
    ];

    const declared = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%references%rules%' COLLATE NOCASE`,
      )
      .map((r) => r.name);
    for (const table of CASCADING) {
      assert.ok(declared.includes(table), `${table} no longer references rules — update this list deliberately`);
    }

    db.delete(rules).run();
    db.insert(rules).values({ id: "cascade-1", name: "R", type: "collection", createdAt: 0 }).run();
    db.insert(ruleRunChanges)
      .values({
        runId: "run-1",
        ruleId: "cascade-1",
        sectionKey: "1",
        sectionTitle: "Movies",
        collectionName: "C",
        itemRatingKey: "rk1",
        itemTitle: "T",
        change: "added",
        at: 0,
      })
      .run();
    db.insert(ruleRuns)
      .values({ id: "rr-1", ruleId: "cascade-1", phase: "done", trigger: "manual", startedAt: 0, updatedAt: 0 })
      .run();

    db.delete(rules).where(eq(rules.id, "cascade-1")).run();

    assert.equal(db.select().from(ruleRunChanges).all().length, 0, "ledger rows went with the rule");
    assert.equal(db.select().from(ruleRuns).all().length, 0, "run history went with the rule");
  });

  test("a cascade does not reach beyond its own rule", () => {
    const { db } = t;
    db.delete(rules).run();
    db.delete(ruleRunChanges).run();
    for (const id of ["keep", "drop"]) {
      db.insert(rules).values({ id, name: id, type: "collection", createdAt: 0 }).run();
      db.insert(ruleRunChanges)
        .values({
          runId: `run-${id}`,
          ruleId: id,
          sectionKey: "1",
          sectionTitle: "Movies",
          collectionName: "C",
          itemRatingKey: "rk",
          itemTitle: "T",
          change: "added",
          at: 0,
        })
        .run();
    }

    db.delete(rules).where(eq(rules.id, "drop")).run();

    const left = db.select().from(ruleRunChanges).all();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.ruleId, "keep");
  });

  test("a row referencing a rule that does not exist is refused", () => {
    // The other half of the pragma being on: without it this insert succeeds
    // and leaves an orphan that the cascade can never clean up.
    assert.throws(
      () =>
        t.db
          .insert(ruleRuns)
          .values({
            id: "rr-x",
            ruleId: "no-such-rule",
            phase: "running",
            trigger: "manual",
            startedAt: 0,
            updatedAt: 0,
          })
          .run(),
      /FOREIGN KEY/,
    );
  });

  test("job checkpoints cascade, but job runs deliberately do not", () => {
    // The asymmetry is worth pinning because it looks like an oversight and
    // isn't. A checkpoint is resumable state that means nothing without its
    // job, so it goes. A run is history — deleting a job that has run is
    // refused outright rather than quietly erasing the record of what it did.
    const { db } = t;
    db.delete(jobRuns).run();
    db.delete(jobs).run();

    db.insert(jobs).values({ id: "job-1", name: "J", command: "generate", schedule: "0 3 * * *" }).run();
    db.insert(jobCheckpoints)
      .values({ jobId: "job-1", data: { cursor: 1 }, updatedAt: 0 })
      .run();
    db.delete(jobs).where(eq(jobs.id, "job-1")).run();
    assert.equal(db.select().from(jobCheckpoints).all().length, 0, "the checkpoint went with the job");

    db.insert(jobs).values({ id: "job-2", name: "J", command: "generate", schedule: "0 3 * * *" }).run();
    db.insert(jobRuns).values({ id: "jr-1", jobId: "job-2", startedAt: 0 }).run();
    assert.throws(
      () => db.delete(jobs).where(eq(jobs.id, "job-2")).run(),
      /FOREIGN KEY/,
      "run history is not erasable",
    );
  });
});

describe("the FTS5 search index", () => {
  let t: TestDb;
  before(() => {
    t = createTestDb();
  });
  after(() => t.dispose());

  const ftsRows = (table: string, key: string) =>
    t.db.all<Record<string, unknown>>(sql.raw(`SELECT ${key} FROM ${table}`));

  test("the virtual tables and their triggers exist", () => {
    // Invisible to drizzle's snapshots, so nothing else would notice if a
    // future `drizzle-kit generate` overwrote them.
    const objects = t.db
      .all<{ name: string; type: string }>(sql`SELECT name, type FROM sqlite_master`)
      .map((r) => `${r.type}:${r.name}`);

    for (const table of ["collections_fts", "media_items_fts", "rules_fts", "jobs_fts"]) {
      assert.ok(objects.includes(`table:${table}`), `${table} is missing`);
    }
    for (const trigger of ["rules_ai", "rules_ad", "rules_au", "media_items_ai", "media_items_ad", "media_items_au"]) {
      assert.ok(objects.includes(`trigger:${trigger}`), `${trigger} is missing`);
    }
  });

  test("an insert reaches the index", () => {
    t.db.delete(rules).run();
    t.db.insert(rules).values({ id: "fts-1", name: "Sci-Fi Gems", type: "collection", createdAt: 0 }).run();

    const hits = t.db.all<{ id: string }>(sql`SELECT id FROM rules_fts WHERE rules_fts MATCH 'Gems'`);
    assert.deepEqual(
      hits.map((h) => h.id),
      ["fts-1"],
    );
  });

  test("an update replaces the indexed row rather than adding a second", () => {
    // The update trigger deletes then inserts. If the delete half stopped
    // firing, search would return both the old and the new name for ever, and
    // the old one would link to a rule whose name no longer matches.
    t.db.delete(rules).run();
    t.db.insert(rules).values({ id: "fts-2", name: "Old Name", type: "collection", createdAt: 0 }).run();
    t.db.update(rules).set({ name: "New Name" }).where(eq(rules.id, "fts-2")).run();

    assert.equal(ftsRows("rules_fts", "id").length, 1, "exactly one indexed row");
    assert.equal(t.db.all(sql`SELECT id FROM rules_fts WHERE rules_fts MATCH 'Old'`).length, 0);
    assert.equal(t.db.all(sql`SELECT id FROM rules_fts WHERE rules_fts MATCH 'New'`).length, 1);
  });

  test("a delete removes the indexed row", () => {
    t.db.delete(rules).run();
    t.db.insert(rules).values({ id: "fts-3", name: "Doomed", type: "collection", createdAt: 0 }).run();
    t.db.delete(rules).where(eq(rules.id, "fts-3")).run();

    assert.equal(ftsRows("rules_fts", "id").length, 0);
  });

  test("a cascaded delete also clears the index", () => {
    // The cascade fires row deletes, so the FTS delete trigger has to fire too.
    // If it didn't, deleting a rule would leave its collections searchable for
    // ever, pointing at rating keys that no longer exist.
    t.db.delete(collections).run();
    t.db
      .insert(collections)
      .values({
        plexRatingKey: "c1",
        title: "Orphan Candidate",
        sectionId: "1",
        sectionTitle: "Movies",
        syncedAt: 0,
      })
      .run();
    assert.equal(
      t.db.all(sql`SELECT plex_rating_key FROM collections_fts WHERE collections_fts MATCH 'Orphan'`).length,
      1,
    );

    t.db.delete(collections).run();

    assert.equal(ftsRows("collections_fts", "plex_rating_key").length, 0);
  });

  test("media items are indexed by title and section", () => {
    t.db.delete(mediaItems).run();
    t.db
      .insert(mediaItems)
      .values({
        ratingKey: "m1",
        title: "Blade Runner",
        sectionId: "1",
        sectionTitle: "Movies",
        type: "movie",
        syncedAt: 0,
      })
      .run();

    assert.equal(t.db.all(sql`SELECT rating_key FROM media_items_fts WHERE media_items_fts MATCH 'Blade'`).length, 1);
    assert.equal(t.db.all(sql`SELECT rating_key FROM media_items_fts WHERE media_items_fts MATCH 'Movies'`).length, 1);
  });

  test("the index is populated for rows that predate it", () => {
    // Each `CREATE VIRTUAL TABLE` is followed by a backfill `INSERT ... SELECT`.
    // Without it, everything already in the library on the day the user
    // upgraded would be permanently unsearchable.
    const source = readFileSync(join(MIGRATIONS_DIR, "0004_fts_search.sql"), "utf8");
    for (const table of ["collections_fts", "media_items_fts", "rules_fts", "jobs_fts"]) {
      assert.match(source, new RegExp(`INSERT INTO \`${table}\`[\\s\\S]*?SELECT`), `${table} has no backfill`);
    }
  });
});
