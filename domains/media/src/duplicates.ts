/**
 * The two shapes of duplicate a Plex library accumulates.
 *
 * **Multiple versions** — one item, several files behind it. This is the one
 * Plex itself creates, and it is invisible everywhere else in the app: the
 * resolution and codec columns describe the *first* version only, so a 4K
 * remux and a 720p rip of the same film render as one tidy 4K row.
 *
 * **Repeated entries** — two separate items that are the same film, usually
 * because the files sit in different folders and matched separately. Plex
 * shows both; nothing until now noticed they were one thing.
 *
 * Both are answered from the local index, so the whole page costs one query
 * and no round trip to the server.
 */
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, mediaItems } from "@tinkerbell/db";

export interface DuplicateItem {
  ratingKey: string;
  title: string;
  year: number | null;
  sectionTitle: string;
  videoResolution: string | null;
  videoCodec: string | null;
  fileSize: number | null;
  bitrate: number | null;
  versionCount: number;
  addedAt: number | null;
}

export interface DuplicateGroup {
  kind: "versions" | "entries";
  /** What the group is about — the title, for both kinds. */
  title: string;
  year: number | null;
  sectionTitle: string;
  items: DuplicateItem[];
  /** Total bytes across the group, where known. */
  bytes: number;
  /**
   * Bytes that would come back if only the recommended keeper survived.
   *
   * Zero for a `versions` group: the size is a per-item sum and there is no
   * per-version breakdown in the index, so claiming a figure would be
   * inventing one. The group still earns its place by being visible at all.
   */
  reclaimable: number;
  /** The rating key this suggests keeping, or null when it cannot tell. */
  keeperRatingKey: string | null;
  /** Why that one, in the words the page shows. */
  keeperReason: string;
}

const RESOLUTION_RANK: Record<string, number> = {
  "8k": 6,
  "4k": 5,
  "1080": 4,
  "720": 3,
  "480": 2,
  sd: 1,
};

function resolutionRank(value: string | null): number {
  if (!value) return 0;
  const label = value.toLowerCase();
  const known = RESOLUTION_RANK[label];
  if (known !== undefined) return known;
  // Plex normally reports `4k`, `1080`, `720`, `sd` — but not always, and an
  // unrecognised label used to rank 0, i.e. equal to "no idea". So a server
  // reporting `2160` tied its 4K copy with a copy of unknown resolution and the
  // group fell through to the size tie-break, or to "nothing separates these".
  // A bare number is a height, which is directly comparable.
  const height = Number.parseInt(label, 10);
  if (Number.isFinite(height) && height > 0) {
    if (height >= 4320) return 6;
    if (height >= 2160) return 5;
    if (height >= 1080) return 4;
    if (height >= 720) return 3;
    if (height >= 480) return 2;
    return 1;
  }
  return 0;
}

/**
 * Which copy to keep, and why.
 *
 * Resolution first, then size — the two rules anyone would apply by hand, in
 * that order, because a bigger 1080p file is still not the 4K one. Returns no
 * recommendation rather than a coin-flip when nothing separates the copies:
 * "keep this one" with no reason behind it is worse than "you decide", since
 * the whole feature is asking someone to delete a file on its say-so.
 */
export function recommendKeeper(items: DuplicateItem[]): { ratingKey: string | null; reason: string } {
  if (items.length === 0) return { ratingKey: null, reason: "" };

  const bestResolution = Math.max(...items.map((i) => resolutionRank(i.videoResolution)));
  const atBestResolution = items.filter((i) => resolutionRank(i.videoResolution) === bestResolution);

  if (atBestResolution.length === 1 && bestResolution > 0) {
    const keeper = atBestResolution[0];
    return {
      ratingKey: keeper.ratingKey,
      reason: `Highest resolution (${keeper.videoResolution?.toUpperCase()}).`,
    };
  }

  const sized = atBestResolution.filter((i) => i.fileSize != null);
  if (sized.length > 1) {
    const largest = [...sized].sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
    if ((largest[0].fileSize ?? 0) > (largest[1].fileSize ?? 0)) {
      return {
        ratingKey: largest[0].ratingKey,
        reason:
          bestResolution > 0
            ? `Largest file at ${largest[0].videoResolution?.toUpperCase()}.`
            : "Largest file — usually the higher bitrate.",
      };
    }
  }

  return { ratingKey: null, reason: "Nothing separates these copies — worth a look before deciding." };
}

function toItem(row: typeof mediaItems.$inferSelect): DuplicateItem {
  return {
    ratingKey: row.ratingKey,
    title: row.title,
    year: row.year,
    sectionTitle: row.sectionTitle,
    videoResolution: row.videoResolution,
    videoCodec: row.videoCodec,
    fileSize: row.fileSize,
    bitrate: row.bitrate,
    versionCount: row.versionCount,
    addedAt: row.addedAt,
  };
}

/** Items Plex holds more than one file for. */
function versionGroups(): DuplicateGroup[] {
  const rows = db
    .select()
    .from(mediaItems)
    .where(gt(mediaItems.versionCount, 1))
    .orderBy(desc(mediaItems.fileSize))
    .all();

  return rows.map((row) => {
    const item = toItem(row);
    return {
      kind: "versions" as const,
      title: row.title,
      year: row.year,
      sectionTitle: row.sectionTitle,
      items: [item],
      bytes: row.fileSize ?? 0,
      // See the field comment: the index holds one summed size per item, not
      // one per version, so there is no honest per-version figure to give.
      reclaimable: 0,
      keeperRatingKey: null,
      keeperReason: `Plex holds ${row.versionCount} versions of this item. Which to keep is decided in Plex, where the individual files are listed.`,
    };
  });
}

/**
 * Separate items that are the same thing.
 *
 * Grouped on lower-cased title plus year within one library. Year matters:
 * remakes share a title and are emphatically not duplicates of each other,
 * and grouping them would be the kind of false positive that gets a whole
 * page distrusted. Items with no year are grouped only with each other.
 */
function entryGroups(): DuplicateGroup[] {
  const dupeKeys = db
    .select({
      sectionId: mediaItems.sectionId,
      title: sql<string>`lower(${mediaItems.title})`.as("lower_title"),
      year: mediaItems.year,
      n: sql<number>`count(*)`.as("n"),
    })
    .from(mediaItems)
    .where(and(isNotNull(mediaItems.title), eq(mediaItems.type, "movie")))
    .groupBy(mediaItems.sectionId, sql`lower(${mediaItems.title})`, mediaItems.year)
    .having(sql`count(*) > 1`)
    .all();

  const groups: DuplicateGroup[] = [];
  for (const key of dupeKeys) {
    const rows = db
      .select()
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.sectionId, key.sectionId),
          sql`lower(${mediaItems.title}) = ${key.title}`,
          key.year == null ? sql`${mediaItems.year} is null` : eq(mediaItems.year, key.year),
        ),
      )
      .all();
    if (rows.length < 2) continue;

    const items = rows.map(toItem);
    const keeper = recommendKeeper(items);
    const bytes = items.reduce((sum, i) => sum + (i.fileSize ?? 0), 0);
    const keeperSize = items.find((i) => i.ratingKey === keeper.ratingKey)?.fileSize ?? 0;

    groups.push({
      kind: "entries",
      title: rows[0].title,
      year: key.year,
      sectionTitle: rows[0].sectionTitle,
      items,
      bytes,
      // Only claimed when there is a keeper to measure against, and only over
      // the copies whose size is actually known.
      reclaimable: keeper.ratingKey ? Math.max(0, bytes - keeperSize) : 0,
      keeperRatingKey: keeper.ratingKey,
      keeperReason: keeper.reason,
    });
  }

  return groups.sort((a, b) => b.reclaimable - a.reclaimable);
}

export interface DuplicateReport {
  groups: DuplicateGroup[];
  /** Total that could come back if every recommendation were followed. */
  reclaimable: number;
}

export function findDuplicates(): DuplicateReport {
  const groups = [...entryGroups(), ...versionGroups()];
  return {
    groups,
    reclaimable: groups.reduce((sum, g) => sum + g.reclaimable, 0),
  };
}
