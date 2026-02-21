/**
 * Media module — sync Plex media items to local SQLite and query them.
 */

import { eq, and, like, sql, type InferSelectModel } from "drizzle-orm";
import { db } from "./db/index.ts";
import { mediaItems } from "./db/schema.ts";
import type { PlexClient, PlexSection } from "./plex.ts";

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
}

export async function syncMedia(
  client: PlexClient,
  sections: PlexSection[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<SyncStats> {
  const now = Date.now();
  const seenKeys = new Set<string>();
  let synced = 0;

  for (const section of sections) {
    for await (const { item, totalSize } of client.allItems(section.key)) {
      const ratingKey = item.ratingKey as string;
      seenKeys.add(ratingKey);

      const media = (item.Media as Array<Record<string, unknown>>)?.[0];

      db.insert(mediaItems)
        .values({
          ratingKey,
          sectionId: section.key,
          sectionTitle: section.title,
          title: item.title as string,
          year: (item.year as number) ?? null,
          thumb: (item.thumb as string) ?? null,
          type: item.type as string,
          addedAt: (item.addedAt as number) ?? null,
          videoResolution: (media?.videoResolution as string) ?? null,
          videoCodec: (media?.videoCodec as string) ?? null,
          audioCodec: (media?.audioCodec as string) ?? null,
          audioChannels: (media?.audioChannels as number) ?? null,
          container: (media?.container as string) ?? null,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: mediaItems.ratingKey,
          set: {
            sectionId: section.key,
            sectionTitle: section.title,
            title: item.title as string,
            year: (item.year as number) ?? null,
            thumb: (item.thumb as string) ?? null,
            type: item.type as string,
            addedAt: (item.addedAt as number) ?? null,
            videoResolution: (media?.videoResolution as string) ?? null,
            videoCodec: (media?.videoCodec as string) ?? null,
            audioCodec: (media?.audioCodec as string) ?? null,
            audioChannels: (media?.audioChannels as number) ?? null,
            container: (media?.container as string) ?? null,
            syncedAt: now,
          },
        })
        .run();
      synced++;

      if (onProgress) {
        onProgress(synced, totalSize, `Syncing ${section.title}...`);
      }
    }
  }

  // Remove stale entries not seen in this sync
  const allRows = db.select({ ratingKey: mediaItems.ratingKey }).from(mediaItems).all();
  let removed = 0;
  for (const row of allRows) {
    if (!seenKeys.has(row.ratingKey)) {
      db.delete(mediaItems).where(eq(mediaItems.ratingKey, row.ratingKey)).run();
      removed++;
    }
  }

  return { synced, removed };
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
    conditions.push(like(mediaItems.title, `%${filters.search}%`));
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
    .orderBy(mediaItems.title)
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
