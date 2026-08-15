/**
 * Media module — sync Plex media items to local SQLite and query them.
 */

import { eq, and, asc, desc, inArray, lt, sql, type InferSelectModel } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db, mediaItems, likeContains } from "@tinkerbell/db";
import { emitEvent } from "@tinkerbell/domain.events";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";

export type MediaItemRow = InferSelectModel<typeof mediaItems>;

interface SyncStats {
  synced: number;
  removed: number;
  /** Items this sync saw for the first time, newest-looking first. */
  added: NewMediaItem[];
}

export interface NewMediaItem {
  ratingKey: string;
  title: string;
  year: number | null;
  type: string;
  sectionTitle: string;
}

/** How many titles to name in the `media.added` message before "and N more". */
const ADDED_SAMPLE_SIZE = 5;

/**
 * Announce what a sync found that wasn't there before.
 *
 * One event per sync rather than one per item: a scan that picks up a
 * 40-episode season is one thing that happened, and a channel that gets 40
 * pings for it is a channel someone mutes.
 *
 * Silent on a library's first sync — `existing` empty means every item is
 * "new", and announcing an entire library on the run that first indexed it is
 * noise, not news.
 */
function announceAdded(added: NewMediaItem[], hadExisting: boolean): void {
  if (!hadExisting || added.length === 0) return;

  const sample = added.slice(0, ADDED_SAMPLE_SIZE).map((i) => (i.year ? `${i.title} (${i.year})` : i.title));
  const more = added.length - sample.length;
  const list = more > 0 ? `${sample.join(", ")} and ${more} more` : sample.join(", ");

  emitEvent("media.added", `${added.length} new item(s): ${list}`, {
    count: added.length,
    titles: sample,
  });
}

/**
 * Value filters are lists — the Media page's filter controls are multi-selects,
 * so "H.264 or HEVC" is one query rather than two views. An empty or absent
 * list means the filter is off; values within a list are OR-ed, and separate
 * filters are AND-ed.
 */
interface MediaFilters {
  sectionIds?: string[];
  types?: string[];
  search?: string;
  videoResolutions?: string[];
  videoCodecs?: string[];
  audioCodecs?: string[];
  audioChannels?: number[];
  containers?: string[];
  offset?: number;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

export interface SyncMediaOptions {
  /**
   * The `syncedAt` watermark to stamp rows with, and the cutoff for the stale
   * sweep at the end.
   *
   * A resumed sync must reuse the *original* run's watermark: rows written by
   * the run that was interrupted already carry it, and a fresh `Date.now()`
   * would make the final sweep delete every one of them.
   */
  syncedAt?: number;
  /** Section keys already synced under this watermark by a previous, interrupted run. */
  skipSectionKeys?: readonly string[];
  /** Called once a section has been fully written, so the caller can checkpoint. */
  onSectionComplete?: (sectionKey: string) => void;
}

export async function syncMedia(
  client: PlexClient,
  sections: PlexSection[],
  onProgress?: (current: number, total: number, message: string) => void,
  options: SyncMediaOptions = {},
): Promise<SyncStats> {
  const now = options.syncedAt ?? Date.now();
  const skip = new Set(options.skipSectionKeys ?? []);
  let synced = 0;

  // One query, held for the duration of the sync, rather than an existence
  // check per item — this loop runs tens of thousands of times on a large
  // library and the whole point is to keep it a single write each.
  //
  // A resumed sync under-reports: items the interrupted run already wrote are
  // in this set and won't be announced again. That is the right trade against
  // re-announcing them, and a sync that survives to the end is the norm.
  const existing = new Set(
    db
      .select({ ratingKey: mediaItems.ratingKey })
      .from(mediaItems)
      .all()
      .map((r) => r.ratingKey),
  );
  const hadExisting = existing.size > 0;
  const added: NewMediaItem[] = [];

  for (const section of sections) {
    if (skip.has(section.key)) continue;
    for await (const { item, totalSize } of client.allItems(section.key)) {
      const ratingKey = item.ratingKey;
      if (!ratingKey) continue;

      const media = item.Media?.[0];
      const genres = item.Genre?.map((g) => g.tag).filter((tag) => tag.length > 0) ?? [];
      const values = {
        ratingKey,
        sectionId: section.key,
        sectionTitle: section.title,
        title: item.title ?? "",
        year: item.year ?? null,
        thumb: item.thumb ?? null,
        type: item.type ?? "",
        addedAt: item.addedAt ?? null,
        // All four come free with the listing this loop is already paging
        // through. An empty genre list is stored as null, not `[]`, so
        // "Plex told us nothing" and "Plex told us none" don't have to be
        // distinguished downstream — neither should exclude an item.
        genres: genres.length > 0 ? genres : null,
        rating: item.rating ?? item.audienceRating ?? null,
        contentRating: item.contentRating ?? null,
        durationMs: item.duration ?? null,
        videoResolution: media?.videoResolution ?? null,
        videoCodec: media?.videoCodec ?? null,
        audioCodec: media?.audioCodec ?? null,
        audioChannels: media?.audioChannels ?? null,
        container: media?.container ?? null,
        syncedAt: now,
      };

      db.insert(mediaItems).values(values).onConflictDoUpdate({ target: mediaItems.ratingKey, set: values }).run();
      synced++;

      if (!existing.has(ratingKey)) {
        existing.add(ratingKey);
        added.push({
          ratingKey,
          title: values.title,
          year: values.year,
          type: values.type,
          sectionTitle: section.title,
        });
      }

      if (onProgress) {
        onProgress(synced, totalSize, `Syncing ${section.title}...`);
      }
    }
    options.onSectionComplete?.(section.key);
  }

  // Remove stale entries not seen in this sync. Single statement avoids the
  // race where a concurrent insert lands between the SELECT and DELETE.
  const result = db.delete(mediaItems).where(lt(mediaItems.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);

  announceAdded(added, hadExisting);

  return { synced, removed, added };
}

const SORT_COLUMNS = {
  title: mediaItems.title,
  section: mediaItems.sectionTitle,
  type: mediaItems.type,
  year: mediaItems.year,
  // Plex omits `addedAt` on some items, and SQLite sorts NULLs last on DESC —
  // so "newest first", the only direction this sort is asked for, puts the
  // items with no date at the end rather than at the top.
  added: mediaItems.addedAt,
  resolution: mediaItems.videoResolution,
  videoCodec: mediaItems.videoCodec,
  audioCodec: mediaItems.audioCodec,
  audioChannels: mediaItems.audioChannels,
  container: mediaItems.container,
} as const;

/** Distinct "Title (Year)" labels matching a query — for type-ahead pickers. */
export function searchMediaTitles(query: string, limit = 20): string[] {
  const q = query.trim();
  if (!q) return [];
  const rows = db
    .select({ title: mediaItems.title, year: mediaItems.year })
    .from(mediaItems)
    .where(likeContains(mediaItems.title, q))
    .orderBy(asc(mediaItems.title))
    .limit(limit * 2)
    .all();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const label = r.year ? `${r.title} (${r.year})` : r.title;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

export function getLocalMediaItems(filters: MediaFilters): {
  items: Array<{
    ratingKey: string;
    title: string;
    year?: number;
    thumb?: string;
    type: string;
    addedAt?: number;
    sectionTitle: string;
    videoResolution?: string;
    videoCodec?: string;
    audioCodec?: string;
    audioChannels?: number;
    container?: string;
  }>;
  total: number;
  offset: number;
  limit: number;
} {
  const conditions = [];

  /** One selected value stays an `=`; several become an `IN`. */
  const anyOf = <T extends string | number>(column: SQLiteColumn, values: T[] | undefined) => {
    if (!values || values.length === 0) return;
    conditions.push(values.length === 1 ? eq(column, values[0]) : inArray(column, values));
  };

  anyOf(mediaItems.sectionId, filters.sectionIds);
  anyOf(mediaItems.type, filters.types);
  if (filters.search) {
    conditions.push(likeContains(mediaItems.title, filters.search));
  }
  anyOf(mediaItems.videoResolution, filters.videoResolutions);
  anyOf(mediaItems.videoCodec, filters.videoCodecs);
  anyOf(mediaItems.audioCodec, filters.audioCodecs);
  anyOf(mediaItems.audioChannels, filters.audioChannels);
  anyOf(mediaItems.container, filters.containers);

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;

  const sortCol = SORT_COLUMNS[filters.sort as keyof typeof SORT_COLUMNS] ?? mediaItems.title;
  const orderFn = filters.sortDir === "desc" ? desc : asc;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(mediaItems)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const rows = db
    .select()
    .from(mediaItems)
    .where(whereClause)
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    items: rows.map((row) => ({
      ratingKey: row.ratingKey,
      title: row.title,
      year: row.year ?? undefined,
      thumb: row.thumb ?? undefined,
      type: row.type,
      addedAt: row.addedAt ?? undefined,
      sectionTitle: row.sectionTitle,
      videoResolution: row.videoResolution ?? undefined,
      videoCodec: row.videoCodec ?? undefined,
      audioCodec: row.audioCodec ?? undefined,
      audioChannels: row.audioChannels ?? undefined,
      container: row.container ?? undefined,
    })),
    total,
    offset,
    limit,
  };
}
