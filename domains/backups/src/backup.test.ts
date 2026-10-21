/**
 * The one test here worth the setup cost is the concurrent-write integrity
 * check. Everything else about a backup can look right and still be a file
 * that won't open, and a naive `cp` of a WAL-mode database passes every test
 * that doesn't write while it copies.
 */
import { describe, test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createTestContainer } from "@rube/composition/test-support";
import { ConfigStoreToken } from "@rube/core";
import { BackupsToken } from "./index.ts";

const c = createTestContainer();
const { setConfig } = c.resolve(ConfigStoreToken);
const { runBackup, listBackups } = c.resolve(BackupsToken);

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "rube-backup-test-"));
  setConfig("backup_dir", dir);
  setConfig("backup_keep_count", 3);
});

after(async () => {
  await c.dispose();
  await rm(dir, { recursive: true, force: true });
});

/** Decompress a backup and open it, so "valid" means SQLite says so. */
async function openBackup(name: string): Promise<Database.Database> {
  const plain = join(dir, `${name}.opened.db`);
  await pipeline(createReadStream(join(dir, name)), createGunzip(), createWriteStream(plain));
  return new Database(plain, { readonly: true });
}

describe("taking a backup", () => {
  test("produces a file that opens and passes an integrity check — while the database is being written", async () => {
    // The whole point. `db.backup()` holds a read lock and restarts if a writer
    // moves pages under it; a file copy does not, and the result is a database
    // that opens and is missing whatever was in the write-ahead log.
    let writing = true;
    let written = 0;
    const writer = (async () => {
      while (writing) {
        setConfig("global_asset_directory", `/assets/${written++}`);
        await new Promise((r) => setImmediate(r));
      }
    })();

    const result = await runBackup();
    writing = false;
    await writer;

    assert.ok(written > 0, "the test needs the database to have been written to during the backup");
    assert.ok(result.sizeBytes > 0);

    const copy = await openBackup(result.name);
    try {
      const integrity = copy.pragma("integrity_check", { simple: true });
      assert.equal(integrity, "ok");
      // Not just openable — actually carrying this install's data.
      const row = copy.prepare("select count(*) as n from config").get() as { n: number };
      assert.ok(row.n > 0, "the backup should contain the config rows that were there when it was taken");
    } finally {
      copy.close();
    }
  });

  test("the copy is a point in time, not a live view", async () => {
    setConfig("global_tmdb_region", "GB");
    const result = await runBackup();
    setConfig("global_tmdb_region", "US");

    const copy = await openBackup(result.name);
    try {
      const row = copy.prepare("select value from config where key = ?").get("global_tmdb_region") as {
        value: string;
      };
      assert.equal(JSON.parse(row.value), "GB", "a change made after the backup must not appear in it");
    } finally {
      copy.close();
    }
  });

  test("leaves no partial files behind", async () => {
    await runBackup();
    const names = await readdir(dir);
    assert.equal(
      names.filter((n) => n.endsWith(".partial")).length,
      0,
      "a finished backup should have cleaned up its temporaries",
    );
  });
});

describe("retention", () => {
  test("keeps exactly the newest N", async () => {
    // Five backups against a keep count of three. Taken in sequence rather
    // than in parallel: they are named by the second, and two in the same
    // second are deliberately the same file.
    for (let i = 0; i < 5; i++) {
      await runBackup();
      await new Promise((r) => setTimeout(r, 1100));
    }

    const files = await listBackups();
    assert.equal(files.length, 3);
    // Newest first, so the three that survived are the three most recent.
    assert.deepEqual(
      [...files].sort((a, b) => b.createdAt - a.createdAt).map((f) => f.name),
      files.map((f) => f.name),
    );
  });

  test("a failed backup does not delete a good one", async () => {
    const before = await listBackups();
    assert.ok(before.length > 0, "the test needs an existing backup to protect");

    // A directory that cannot be written to: the copy fails before anything is
    // pruned, which is the ordering this asserts.
    setConfig("backup_dir", join(dir, "nested", "\u0000invalid"));
    await assert.rejects(() => runBackup());

    setConfig("backup_dir", dir);
    const after = await listBackups();
    assert.deepEqual(
      after.map((f) => f.name),
      before.map((f) => f.name),
      "the existing backups must survive a failed run untouched",
    );
  });
});

describe("listing", () => {
  test("ignores files that aren't backups", async () => {
    await writeFile(join(dir, "notes.txt"), "not a backup");
    const files = await listBackups();
    assert.ok(!files.some((f) => f.name === "notes.txt"));
  });

  test("a missing directory lists as empty rather than throwing", async () => {
    setConfig("backup_dir", join(dir, "does-not-exist"));
    assert.deepEqual(await listBackups(), []);
    setConfig("backup_dir", dir);
  });
});
