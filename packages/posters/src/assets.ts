import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/**
 * Reading artwork out of a Kometa asset directory.
 *
 * Kometa's assets are the one part of a config that isn't config: a tree of
 * image files, matched to items and collections by *name*. Migrating the YAML
 * and leaving the assets behind would strip the posters off a library that a
 * person had spent real time curating — which is why "we can't read those" was
 * the wrong answer.
 *
 * Kometa accepts two layouts, and both are common enough that supporting one
 * would strand half of everybody:
 *
 *   assets/Star Wars (1977)/poster.jpg     ← folder form
 *   assets/Star Wars (1977).jpg            ← flat form
 *
 * Matching is by name, case-insensitively, with a small amount of forgiveness
 * around punctuation — a filesystem that can't hold `:` means "Alien: Covenant"
 * is on disk as "Alien - Covenant", and an exact-match-only resolver would
 * quietly find nothing for exactly the titles most likely to have hand-made art.
 *
 * This module only *reads*. Validation and resizing are `normalizePosterUpload`'s
 * job, which every other poster path already goes through: a file someone
 * copied into a directory is exactly as untrusted as one they uploaded.
 */

/** Image extensions Kometa writes, in the order it prefers them. */
const EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** Basenames Kometa uses inside an item's folder. */
const POSTER_NAMES = ["poster", "folder", "cover", "default"];
const BACKGROUND_NAMES = ["background", "fanart", "backdrop", "art"];

/** Nothing here should ever read outside the configured root. */
function isSafeSegment(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
}

/**
 * Collapse a name to something two filesystems can agree on.
 *
 * Punctuation is dropped rather than mapped because the substitutions differ
 * per tool and per OS — Kometa writes `:` as `-`, some users write it as nothing
 * at all, and NTFS forbids it outright. Comparing the letters and digits alone
 * makes all three spellings meet.
 */
export function normaliseAssetName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks so "Amélie" matches "Amelie". Written as escapes
      // rather than literal combining characters, which are invisible in a diff.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

export interface AssetIndex {
  /** Normalised name → absolute directory path, for the folder layout. */
  folders: Map<string, string>;
  /** Normalised name → absolute file path, for the flat layout. */
  files: Map<string, string>;
  /** How many entries were found, for the "we read your assets" report. */
  size: number;
}

const EMPTY_INDEX: AssetIndex = { folders: new Map(), files: new Map(), size: 0 };

/** Ceilings, so a mis-typed root can't walk somebody's whole disk. */
const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 3;

/**
 * Index an asset directory once, so matching a thousand collections doesn't
 * mean a thousand directory reads.
 *
 * Kometa nests assets by library when `asset_folders` is on
 * (`assets/Movies/Star Wars (1977)/poster.jpg`), so subdirectories are
 * descended and their entries indexed under the leaf name. A name appearing at
 * two depths keeps the shallower one — that's the one the user most likely
 * meant, and it makes the result independent of readdir order.
 */
export async function indexAssetDirectory(root: string): Promise<AssetIndex> {
  if (!root.trim()) return EMPTY_INDEX;
  if (!isAbsolute(root)) throw new Error("The asset directory has to be an absolute path.");

  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`No directory found at ${root}.`);

  const folders = new Map<string, string>();
  const files = new Map<string, string>();
  let count = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || count >= MAX_ENTRIES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (count >= MAX_ENTRIES) return;
      if (entry.name.startsWith(".") || !isSafeSegment(entry.name)) continue;
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        const key = normaliseAssetName(entry.name);
        if (key && !folders.has(key)) {
          folders.set(key, full);
          count++;
        }
        await walk(full, depth + 1);
        continue;
      }

      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) continue;
      const ext = entry.name.slice(dot + 1).toLowerCase();
      if (!EXTENSIONS.includes(ext as (typeof EXTENSIONS)[number])) continue;

      const key = normaliseAssetName(entry.name.slice(0, dot));
      if (key && !files.has(key)) {
        files.set(key, full);
        count++;
      }
    }
  };

  await walk(root, 0);
  return { folders, files, size: folders.size + files.size };
}

export type AssetKind = "poster" | "background";

/**
 * Find the artwork for one name, or null.
 *
 * The folder layout wins over the flat one when both exist: a folder is the
 * more deliberate arrangement, and it's the only one that can also hold a
 * background and season art.
 */
export async function findAsset(index: AssetIndex, name: string, kind: AssetKind = "poster"): Promise<string | null> {
  const key = normaliseAssetName(name);
  if (!key) return null;

  const folder = index.folders.get(key);
  if (folder) {
    const wanted = kind === "poster" ? POSTER_NAMES : BACKGROUND_NAMES;
    for (const base of wanted) {
      for (const ext of EXTENSIONS) {
        const candidate = join(folder, `${base}.${ext}`);
        const info = await stat(candidate).catch(() => null);
        if (info?.isFile()) return candidate;
      }
    }
    // A folder with no recognisable poster inside is a miss, not a reason to
    // fall through to a same-named flat file that probably doesn't exist.
    return null;
  }

  // The flat layout has no way to express a background.
  return kind === "poster" ? (index.files.get(key) ?? null) : null;
}

/** Read an asset's bytes. Validation is the caller's (`normalizePosterUpload`). */
export async function readAsset(path: string): Promise<Buffer> {
  return readFile(path);
}
