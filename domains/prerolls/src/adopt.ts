/**
 * Adopting prerolls that are already on disk.
 *
 * `PREROLLS_DIR` is a bind mount the admin can write to directly, so it often
 * arrives with videos in it already — copied from a previous tool, restored
 * from a backup, or dropped in by hand. Those files are invisible to
 * Rube (Plex plays only what the preference names, and the preference is
 * built from the database), so this turns them into real rows.
 *
 * Adoption reuses the upload path rather than trusting the file: the video is
 * moved into `incoming/` and handed to `preroll-process`, which probes it and
 * transcodes anything Plex wouldn't direct play. A file someone copied in is
 * exactly as likely to be a 4K HEVC mkv as an uploaded one.
 */

import { readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { prerollsDir } from "@rube/core";
import { ensurePrerollDirs, extensionOf, incomingPath, type CreatePrerollInput, type Preroll } from "./index.ts";
import { ALLOWED_EXTENSIONS, assertSupportedFilename } from "./ingest.ts";
import { isBareFilename } from "./safe-name.ts";

/** A video sitting in `PREROLLS_DIR` that no row claims. */
export type OrphanFile = {
  filename: string;
  sizeBytes: number;
  modifiedAt: number;
};

export class OrphanNotFoundError extends Error {
  constructor(filename: string) {
    super(`${filename} is no longer in the prerolls folder`);
    this.name = "OrphanNotFoundError";
  }
}

function stripExtension(filename: string): string {
  const ext = extensionOf(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

/**
 * Structural rather than `prerolls: Prerolls`.
 *
 * `Prerolls` is `ReturnType<typeof createPrerolls>`, and `createPrerolls` is
 * what supplies this — naming the whole type here makes the alias reference
 * itself. Listing the three functions actually used says more anyway.
 */
export interface AdoptDeps {
  prerolls: {
    createPreroll(input: CreatePrerollInput): Preroll;
    deletePreroll(id: string): Promise<boolean>;
    listPrerolls(): Preroll[];
  };
}
export function createAdopt(deps: AdoptDeps) {
  const { createPreroll, deletePreroll, listPrerolls } = deps.prerolls;

  /** Filenames the database already accounts for, so a scan can skip them. */
  function trackedFilenames(): Set<string> {
    const tracked = new Set<string>();
    for (const row of listPrerolls()) {
      if (row.filename) tracked.add(row.filename);
    }
    return tracked;
  }

  /**
   * List adoptable videos at the top level of `PREROLLS_DIR`.
   *
   * Only the top level: `incoming/` holds half-written uploads and files the
   * processing job is about to consume, and `thumbs/` holds jpegs — neither is
   * something to offer the user. Sorted by name so the list is stable across
   * polls rather than in whatever order the filesystem hands them back.
   */
  async function scanOrphans(): Promise<OrphanFile[]> {
    await ensurePrerollDirs();
    const dir = prerollsDir();
    const tracked = trackedFilenames();

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is already reported by `getEnvironment` as "not
      // writable"; there's nothing more useful to say from here.
      return [];
    }

    const found: OrphanFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (tracked.has(entry.name)) continue;
      if (!ALLOWED_EXTENSIONS.has(extensionOf(entry.name))) continue;
      try {
        const info = await stat(join(dir, entry.name));
        found.push({ filename: entry.name, sizeBytes: info.size, modifiedAt: info.mtimeMs });
      } catch {
        // Raced with a delete between readdir and stat — just leave it out.
      }
    }
    return found.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  /**
   * Adopt one orphan: create its row and move the file into `incoming/` for the
   * processing job to pick up.
   *
   * A move rather than a copy. The file is already inside the directory
   * Rube owns, the destination is the same filesystem so the rename is
   * atomic and free, and copying would silently double the disk footprint of a
   * library that can run to gigabytes. If processing fails the bytes are still
   * there under the row's id, and the failed row offers a retry.
   */
  async function adoptOrphan(filename: string, name?: string): Promise<Preroll> {
    // The filename comes from the browser, so it gets the path check before it
    // gets anywhere near a `join`.
    if (!isBareFilename(filename)) throw new OrphanNotFoundError(filename);
    if (trackedFilenames().has(filename)) throw new OrphanNotFoundError(filename);

    const ext = assertSupportedFilename(filename);
    const source = join(prerollsDir(), filename);
    const info = await stat(source).catch(() => null);
    if (!info?.isFile()) throw new OrphanNotFoundError(filename);

    await ensurePrerollDirs();
    const row = createPreroll({ name: name?.trim() || stripExtension(filename), originalFilename: filename });

    try {
      await rename(source, incomingPath(row.id, ext));
    } catch (err) {
      // The row is deleted rather than left `failed`: nothing moved, so the file
      // is still adoptable and a failed row would just be noise the user has to
      // clear before trying again.
      await deletePreroll(row.id);
      throw err;
    }

    return row;
  }

  return { scanOrphans, adoptOrphan };
}
