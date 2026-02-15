/**
 * Collections module — sync Plex collections to local SQLite and manage them.
 */

import { eq, and, like, type InferSelectModel } from "drizzle-orm";
import { db } from "./db/index.ts";
import { collections } from "./db/schema.ts";
import type { PlexClient, PlexSection } from "./plex.ts";

export type CollectionRow = InferSelectModel<typeof collections>;

interface SyncStats {
  synced: number;
  removed: number;
}

interface CollectionFilters {
  sectionId?: string;
  label?: string;
  search?: string;
}

export async function syncCollections(client: PlexClient, sections: PlexSection[]): Promise<SyncStats> {
  const now = Date.now();
  const seenKeys = new Set<string>();

  let synced = 0;

  for (const section of sections) {
    const colls = await client.getCollections(section.key);

    for (const col of colls) {
      const detail = await client.getCollectionDetail(col.ratingKey);
      seenKeys.add(col.ratingKey);

      db.insert(collections)
        .values({
          plexRatingKey: col.ratingKey,
          sectionId: section.key,
          sectionTitle: section.title,
          title: detail.title,
          summary: detail.summary,
          childCount: detail.childCount,
          labels: JSON.stringify(detail.labels),
          addedAt: detail.addedAt ?? null,
          thumb: detail.thumb,
          smart: detail.smart ? 1 : 0,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: collections.plexRatingKey,
          set: {
            sectionId: section.key,
            sectionTitle: section.title,
            title: detail.title,
            summary: detail.summary,
            childCount: detail.childCount,
            labels: JSON.stringify(detail.labels),
            addedAt: detail.addedAt ?? null,
            thumb: detail.thumb,
            smart: detail.smart ? 1 : 0,
            syncedAt: now,
          },
        })
        .run();
      synced++;
    }
  }

  // Remove stale entries
  const allRows = db.select({ plexRatingKey: collections.plexRatingKey }).from(collections).all();

  let removed = 0;
  for (const row of allRows) {
    if (!seenKeys.has(row.plexRatingKey)) {
      db.delete(collections).where(eq(collections.plexRatingKey, row.plexRatingKey)).run();
      removed++;
    }
  }

  return { synced, removed };
}

export function getLocalCollections(filters?: CollectionFilters): CollectionRow[] {
  const conditions = [];

  if (filters?.sectionId) {
    conditions.push(eq(collections.sectionId, filters.sectionId));
  }

  if (filters?.label) {
    conditions.push(like(collections.labels, `%${JSON.stringify(filters.label).slice(1, -1)}%`));
  }

  if (filters?.search) {
    conditions.push(like(collections.title, `%${filters.search}%`));
  }

  const query = db.select().from(collections);
  if (conditions.length > 0) {
    return query
      .where(and(...conditions))
      .orderBy(collections.title)
      .all();
  }
  return query.orderBy(collections.title).all();
}

export function getLocalCollection(ratingKey: string): CollectionRow | undefined {
  return db.select().from(collections).where(eq(collections.plexRatingKey, ratingKey)).get();
}

export async function updateCollection(
  client: PlexClient,
  ratingKey: string,
  updates: { title?: string; summary?: string },
): Promise<void> {
  await client.updateCollection(ratingKey, updates);

  if (updates.title !== undefined) {
    db.update(collections).set({ title: updates.title }).where(eq(collections.plexRatingKey, ratingKey)).run();
  }
  if (updates.summary !== undefined) {
    db.update(collections).set({ summary: updates.summary }).where(eq(collections.plexRatingKey, ratingKey)).run();
  }
}

export async function updateCollectionLabels(client: PlexClient, ratingKey: string, labels: string[]): Promise<void> {
  const row = getLocalCollection(ratingKey);
  if (!row) throw new Error(`Collection ${ratingKey} not found`);
  await client.setCollectionLabels(row.sectionId, ratingKey, labels);
  db.update(collections)
    .set({ labels: JSON.stringify(labels) })
    .where(eq(collections.plexRatingKey, ratingKey))
    .run();
}

export async function deleteCollection(client: PlexClient, ratingKey: string): Promise<void> {
  await client.deleteItem(ratingKey);
  db.delete(collections).where(eq(collections.plexRatingKey, ratingKey)).run();
}
