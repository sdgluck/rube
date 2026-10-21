/* ─── Copies of the database, taken while it is running ─────────────────────
 *
 * Export (see `domains/portability`) covers "move to a new server". It does
 * not cover "the disk had a bad day": it carries rules, schedules and settings,
 * not the playback history, the watch state, the cleanup ledger or the
 * metadata snapshots that make an undo possible. For that you need the
 * database.
 *
 * Two decisions worth stating, because both are the difference between a
 * backup and the appearance of one:
 *
 * **`db.backup()`, never a file copy.** The database runs in WAL mode. Copying
 * `rube.db` while anything is writing produces a file that opens fine,
 * passes a cursory look, and is missing whatever was in the log — you find out
 * on the day you restore it. SQLite's online backup API walks the pages under a
 * read lock and restarts if a writer moves them, which is exactly the problem
 * it exists to solve.
 *
 * **Prune only after a good run.** A backup that fails must never be the reason
 * an old good one is deleted. The retention sweep happens after the new file is
 * written and verified, so the worst case of a broken backup job is that the
 * copies stop getting fresher, not that they stop existing.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { token } from "@rube/container";
import { createLogger, dataDir, errorMessage, type ConfigStore } from "@rube/core";
import type { Db } from "@rube/db";
import type { EventBus } from "@rube/ports";
import { backupDirMount } from "./mount.ts";

export { backupDirMount, runningInContainer, type BackupDirMount } from "./mount.ts";

const log = createLogger("backup");

/** `rube-2026-08-20T0300.db.gz` — sortable, and obvious in a file listing. */
const FILE_PREFIX = "rube-";
const FILE_SUFFIX = ".db.gz";

export const DEFAULT_KEEP_COUNT = 7;
export const DEFAULT_SCHEDULE = "30 3 * * *";

/** Where backups go when nobody has said otherwise. */
export function defaultBackupDir(): string {
  return join(dataDir(), "backups");
}

export function backupDir(config: ConfigStore): string {
  const configured = config.getConfig("backup_dir")?.trim();
  return configured ? configured : defaultBackupDir();
}

export function backupPath(config: ConfigStore, name: string): string {
  return join(backupDir(config), name);
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: number;
}

/**
 * Every backup on disk, newest first.
 *
 * Reads the directory rather than a table. A row saying a file exists is a row
 * that can be wrong — somebody clearing space is the *expected* way for one of
 * these to disappear — and a Backups page listing files that aren't there is
 * worse than no page at all.
 */
export async function listBackups(config: ConfigStore): Promise<BackupFile[]> {
  const dir = backupDir(config);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // No directory yet is the normal state before the first run, not an error.
    return [];
  }

  const files: BackupFile[] = [];
  for (const name of names) {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) files.push({ name, sizeBytes: info.size, createdAt: info.mtimeMs });
    } catch {
      // Raced with a deletion. It isn't in the list, which is correct.
    }
  }
  return files.sort((a, b) => b.createdAt - a.createdAt);
}

export interface BackupsDeps {
  db: Db;
  config: ConfigStore;
  emitEvent: EventBus;
}

export interface BackupResult {
  name: string;
  sizeBytes: number;
  /** How many old files the retention sweep removed. */
  pruned: number;
}

export function createBackups(deps: BackupsDeps) {
  const { db, config, emitEvent } = deps;

  function keepCount(): number {
    return config.getConfig("backup_keep_count") ?? DEFAULT_KEEP_COUNT;
  }

  /**
   * Take one backup.
   *
   * Sequence matters: write to a temporary name, verify, rename into place,
   * then prune. A crash halfway through leaves a `.partial` that the listing
   * ignores and the next run overwrites, rather than a truncated file sitting
   * in the list looking like a backup.
   */
  async function runBackup(onProgress?: (message: string) => void): Promise<BackupResult> {
    const dir = backupDir(config);
    await mkdir(dir, { recursive: true });

    // `2026-08-20T03:30:00.000Z` → `20260820T033000`: sortable as text, and
    // free of the colons that Windows refuses in a filename.
    const stamp = new Date().toISOString().replace(/[:-]/g, "").replace(/\..+$/, "");
    const name = `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
    const finalPath = join(dir, name);
    const rawPath = join(dir, `${name}.raw.partial`);
    const gzPath = join(dir, `${name}.partial`);

    try {
      onProgress?.("Copying the database");
      // better-sqlite3's `backup` is the online backup API: safe against
      // concurrent writers, which is the entire reason this is not `cp`.
      await db.$client.backup(rawPath);

      onProgress?.("Compressing");
      // A Rube database is mostly text — rule configs, item titles, job
      // logs — and compresses hard, typically to a fifth.
      await pipeline(createReadStream(rawPath), createGzip(), createWriteStream(gzPath));

      const info = await stat(gzPath);
      if (info.size === 0) throw new Error("the compressed backup was empty");

      // `rm` before rename: Windows refuses to rename onto an existing file,
      // and a same-second re-run is exactly what a "Back up now" button
      // pressed twice produces.
      await rm(finalPath, { force: true });
      await rename(gzPath, finalPath);
      await rm(rawPath, { force: true });

      const pruned = await prune();
      log.info("backup written", { name, sizeBytes: info.size, pruned });
      emitEvent("backup.completed", `Database backed up (${name})`, { name, sizeBytes: info.size, pruned });
      return { name, sizeBytes: info.size, pruned };
    } catch (err) {
      await rm(rawPath, { force: true }).catch(() => {});
      await rm(gzPath, { force: true }).catch(() => {});
      log.error("backup failed", { err: errorMessage(err) });
      emitEvent("backup.failed", `Database backup failed: ${errorMessage(err)}`);
      throw err;
    }
  }

  /** Delete everything past `backup_keep_count`. Never called on a failed run. */
  async function prune(): Promise<number> {
    const files = await listBackups(config);
    const doomed = files.slice(keepCount());
    let removed = 0;
    for (const file of doomed) {
      try {
        await rm(backupPath(config, file.name));
        removed++;
      } catch (err) {
        log.warn("could not remove an old backup", { name: file.name, err: errorMessage(err) });
      }
    }
    return removed;
  }

  function backupsEnabled(): boolean {
    return config.getConfig("backup_enabled") ?? true;
  }

  return {
    runBackup,
    prune,
    listBackups: () => listBackups(config),
    backupsEnabled,
    backupDir: () => backupDir(config),
    directoryMount: () => backupDirMount(backupDir(config)),
  };
}

export type Backups = ReturnType<typeof createBackups>;

export const BackupsToken = token<Backups>("domain.backups");
