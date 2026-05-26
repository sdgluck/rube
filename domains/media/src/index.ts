/**
 * Media module — sync Plex media items to local SQLite and query them.
 */

import { eq, and, asc, desc, lt, sql, type InferSelectModel } from "drizzle-orm";
import { db, mediaItems, likeContains } from "@tinkerbell/db";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";

export type MediaItemRow = InferSelectModel<typeof mediaItems>;

interface SyncStats {
  synced: number;
  removed: number;
}

interface MediaFilters {
  sectionId?: string;
  type?: string;
  search?: string;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  offset?: number;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

export async function syncMedia(
  client: PlexClient,
  sections: PlexSection[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<SyncStats> {
  const now = Date.now();
  let synced = 0;

  for (const section of sections) {
    for await (const { item, totalSize } of client.allItems(section.key)) {
      const ratingKey = item.ratingKey;
      if (!ratingKey) continue;

      const media = item.Media?.[0];
      const values = {
        ratingKey,
        sectionId: section.key,
        sectionTitle: section.title,
        title: item.title ?? "",
        year: item.year ?? null,
        thumb: item.thumb ?? null,
        type: item.type ?? "",
        addedAt: item.addedAt ?? null,
        videoResolution: media?.videoResolution ?? null,
        videoCodec: media?.videoCodec ?? null,
        audioCodec: media?.audioCodec ?? null,
        audioChannels: media?.audioChannels ?? null,
        container: media?.container ?? null,
        syncedAt: now,
      };

      db.insert(mediaItems).values(values).onConflictDoUpdate({ target: mediaItems.ratingKey, set: values }).run();
      synced++;

      if (onProgress) {
        onProgress(synced, totalSize, `Syncing ${section.title}...`);
      }
    }
  }

  // Remove stale entries not seen in this sync. Single statement avoids the
  // race where a concurrent insert lands between the SELECT and DELETE.
  const result = db.delete(mediaItems).where(lt(mediaItems.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);

  return { synced, removed };
}

const SORT_COLUMNS = {
  title: mediaItems.title,
  section: mediaItems.sectionTitle,
  type: mediaItems.type,
  year: mediaItems.year,
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

  if (filters.sectionId) {
    conditions.push(eq(mediaItems.sectionId, filters.sectionId));
  }
  if (filters.type) {
    conditions.push(eq(mediaItems.type, filters.type));
  }
  if (filters.search) {
    conditions.push(likeContains(mediaItems.title, filters.search));
  }
  if (filters.videoResolution) {
    conditions.push(eq(mediaItems.videoResolution, filters.videoResolution));
  }
  if (filters.videoCodec) {
    conditions.push(eq(mediaItems.videoCodec, filters.videoCodec));
  }
  if (filters.audioCodec) {
    conditions.push(eq(mediaItems.audioCodec, filters.audioCodec));
  }
  if (filters.audioChannels) {
    conditions.push(eq(mediaItems.audioChannels, filters.audioChannels));
  }
  if (filters.container) {
    conditions.push(eq(mediaItems.container, filters.container));
  }

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
