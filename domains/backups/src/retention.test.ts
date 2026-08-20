/**
 * `runBackup` and `listBackups` were tested; `prune` — the half that **deletes
 * files** — was not.
 *
 * The asymmetry matters. A bug in `runBackup` produces a backup that is missing
 * or broken, which the next run fixes. A bug in `prune` deletes the backups the
 * user still has, and there is no next run that undoes it. The specific ways it
 * could go wrong:
 *
 * - Sorting the wrong way and keeping the *oldest* N. Every file involved is a
 *   valid backup, so nothing looks broken until someone needs one.
 * - Treating the keep count as an index rather than a count, keeping N+1 or
 *   N−1 — the second of which silently deletes a backup the user configured to
 *   keep.
 * - Matching more than backups. `prune` deletes whatever `listBackups`
 *   returned, so `listBackups`' prefix/suffix filter is load-bearing: a
 *   loosened filter turns a retention sweep into `rm` over the user's chosen
 *   directory, which they may well have pointed at something else.
 *
 * Real files in a temp directory rather than a stubbed `fs`: the thing under
 * test is which files end up on disk.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ConfigStoreToken } from "@tinkerbell/core";
import { BackupsToken, DEFAULT_KEEP_COUNT, backupDir, backupPath, defaultBackupDir, listBackups } from "./index.ts";

const c = createTestContainer();
const config = c.resolve(ConfigStoreToken);
const { setConfig } = config;
const { prune, backupsEnabled } = c.resolve(BackupsToken);

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tinkerbell-retention-"));
  setConfig("backup_dir", dir);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await c.dispose();
});

beforeEach(async () => {
  for (const name of await readdir(dir)) await rm(join(dir, name), { force: true });
  setConfig("backup_keep_count", DEFAULT_KEEP_COUNT);
});

/** A backup file whose mtime — which is what the listing sorts on — is `age` ms ago. */
async function seedBackup(name: string, ageMs: number): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, "x");
  const when = new Date(Date.now() - ageMs);
  await utimes(path, when, when);
}

async function seedNumbered(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    // Older as i grows, so index 0 is the newest.
    await seedBackup(`tinkerbell-2026010${i}T000000.db.gz`, i * 60_000);
  }
}

const onDisk = async () => (await readdir(dir)).sort();

describe("prune", () => {
  test("keeps the configured number and deletes the rest", async () => {
    setConfig("backup_keep_count", 3);
    await seedNumbered(6);

    const removed = await prune();

    assert.equal(removed, 3);
    assert.equal((await onDisk()).length, 3);
  });

  test("keeps the NEWEST, not the oldest", async () => {
    // The failure mode with no symptom: every remaining file is a valid
    // backup, so nothing looks wrong until somebody needs a recent one.
    setConfig("backup_keep_count", 2);
    await seedBackup("tinkerbell-20260101T000000.db.gz", 3 * 60_000);
    await seedBackup("tinkerbell-20260102T000000.db.gz", 2 * 60_000);
    await seedBackup("tinkerbell-20260103T000000.db.gz", 1 * 60_000);

    await prune();

    assert.deepEqual(await onDisk(), ["tinkerbell-20260102T000000.db.gz", "tinkerbell-20260103T000000.db.gz"]);
  });

  test("keeps exactly the count, not one either side", async () => {
    setConfig("backup_keep_count", 5);
    await seedNumbered(5);

    assert.equal(await prune(), 0, "at the limit, nothing is removed");
    assert.equal((await onDisk()).length, 5);

    await seedBackup("tinkerbell-20260199T000000.db.gz", 0);
    assert.equal(await prune(), 1, "one over the limit removes exactly one");
    assert.equal((await onDisk()).length, 5);
  });

  test("does nothing when there are fewer backups than the limit", async () => {
    setConfig("backup_keep_count", 7);
    await seedNumbered(2);

    assert.equal(await prune(), 0);
    assert.equal((await onDisk()).length, 2);
  });

  test("an empty directory is not an error", async () => {
    assert.equal(await prune(), 0);
  });

  test("a directory that does not exist yet is not an error", async () => {
    // The state before the first backup ever runs.
    setConfig("backup_dir", join(dir, "not-created-yet"));
    try {
      assert.equal(await prune(), 0);
    } finally {
      setConfig("backup_dir", dir);
    }
  });

  test("a keep count of zero is refused, so prune can never empty the directory", async () => {
    // There is a floor of 1 in the config schema. It means "delete every
    // backup" is not a reachable state — worth an explicit test, because
    // nothing in `prune` itself would stop it.
    await seedNumbered(3);

    assert.throws(() => setConfig("backup_keep_count", 0 as never), /Too small/);

    assert.equal(await prune(), 0, "the keep count is still the default");
    assert.equal((await onDisk()).length, 3, "nothing was deleted");
  });

  test("does not touch files that are not backups", async () => {
    // `prune` deletes what `listBackups` returns, and the backup directory is
    // user-configurable — someone will point it at a folder that has other
    // things in it.
    setConfig("backup_keep_count", 1);
    await writeFile(join(dir, "notes.txt"), "keep me");
    await writeFile(join(dir, "tinkerbell-config.json"), "wrong suffix");
    await writeFile(join(dir, "other-20260101T000000.db.gz"), "wrong prefix");
    await seedBackup("tinkerbell-20260101T000000.db.gz", 60_000);
    await seedBackup("tinkerbell-20260102T000000.db.gz", 0);

    const removed = await prune();

    assert.equal(removed, 1, "only the surplus backup");
    assert.deepEqual(await onDisk(), [
      "notes.txt",
      "other-20260101T000000.db.gz",
      "tinkerbell-20260102T000000.db.gz",
      "tinkerbell-config.json",
    ]);
  });

  test("ignores the partial files a crashed run leaves behind", async () => {
    // `.partial` is written mid-backup. It is neither a backup to keep nor one
    // to count towards the limit; the next run overwrites it.
    setConfig("backup_keep_count", 1);
    await seedBackup("tinkerbell-20260101T000000.db.gz", 0);
    await writeFile(join(dir, "tinkerbell-20260102T000000.db.gz.partial"), "half");
    await writeFile(join(dir, "tinkerbell-20260102T000000.db.gz.raw.partial"), "half");

    await prune();

    assert.ok((await onDisk()).includes("tinkerbell-20260101T000000.db.gz"));
    assert.ok((await onDisk()).includes("tinkerbell-20260102T000000.db.gz.partial"), "left for the next run");
  });

  test("a file that vanishes mid-prune does not abort the sweep", async () => {
    // Another process clearing space is the expected way for one of these to
    // disappear. The rest of the sweep still has to happen.
    setConfig("backup_keep_count", 1);
    await seedNumbered(4);
    const listed = await listBackups(config);
    // Remove one of the three that prune is about to delete, behind its back.
    await rm(backupPath(config, listed[2]!.name));

    const removed = await prune();

    assert.equal(removed, 2, "the two that were still there");
    assert.equal((await onDisk()).length, 1, "and it still got down to the limit");
  });
});

describe("configuration", () => {
  test("a fresh install keeps seven backups and takes them without being asked", () => {
    // The defaults are the behaviour for everyone who never opens Settings.
    assert.equal(DEFAULT_KEEP_COUNT, 7);
    assert.equal(backupsEnabled(), true);
  });

  test("backups can be switched off and on again", () => {
    setConfig("backup_enabled", false);
    assert.equal(backupsEnabled(), false);

    setConfig("backup_enabled", true);
    assert.equal(backupsEnabled(), true);
  });

  test("backupDir falls back to the default when unset or blank", () => {
    setConfig("backup_dir", "");
    assert.equal(backupDir(config), defaultBackupDir());

    setConfig("backup_dir", "   ");
    assert.equal(backupDir(config), defaultBackupDir(), "whitespace is not a path");

    setConfig("backup_dir", dir);
    assert.equal(backupDir(config), dir);
  });

  test("backupPath joins onto the configured directory", () => {
    setConfig("backup_dir", dir);
    assert.equal(backupPath(config, "tinkerbell-x.db.gz"), join(dir, "tinkerbell-x.db.gz"));
  });
});
