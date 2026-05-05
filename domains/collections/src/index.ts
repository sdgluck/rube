/**
 * Collections module — sync Plex collections to local SQLite and manage them.
 */

import { eq, and, like, asc, desc, lt, sql, type InferSelectModel } from "drizzle-orm";
import { db, collections } from "@tinkerbell/db";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { scanKometaState } from "@tinkerbell/domain.migration";

export type CollectionRow = InferSelectModel<typeof collections>;

interface SyncStats {
  synced: number;
  removed: number;
}

interface CollectionFilters {
  sectionId?: string;
  label?: string;
  search?: string;
  offset?: number;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

export async function upsertCollectionByKey(
  client: PlexClient,
  section: PlexSection,
  ratingKey: string,
): Promise<void> {
  const detail = await client.getCollectionDetail(ratingKey);
  const now = Date.now();
  const values = {
    plexRatingKey: ratingKey,
    sectionId: section.key,
    sectionTitle: section.title,
    title: detail.title,
    summary: detail.summary,
    childCount: detail.childCount,
    labels: detail.labels,
    addedAt: detail.addedAt ?? null,
    thumb: detail.thumb,
    smart: detail.smart ? 1 : 0,
    syncedAt: now,
  };
  db.insert(collections).values(values).onConflictDoUpdate({ target: collections.plexRatingKey, set: values }).run();
}

export async function syncCollections(client: PlexClient, sections: PlexSection[]): Promise<SyncStats> {
  const now = Date.now();

  let synced = 0;

  for (const section of sections) {
    const colls = await client.getCollections(section.key);

    for (const col of colls) {
      const detail = await client.getCollectionDetail(col.ratingKey);

      db.insert(collections)
        .values({
          plexRatingKey: col.ratingKey,
          sectionId: section.key,
          sectionTitle: section.title,
          title: detail.title,
          summary: detail.summary,
          childCount: detail.childCount,
          labels: detail.labels,
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
            labels: detail.labels,
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

  // Remove stale entries in a single statement to avoid races with
  // concurrent inserts between SELECT and DELETE.
  const result = db.delete(collections).where(lt(collections.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);

  // Refresh the Kometa migration scan so the banner / Settings → Migrate
  // page reflects the freshly-synced label set without an explicit refetch.
  try {
    scanKometaState();
  } catch (err) {
    console.warn("[collections] Failed to refresh Kometa migration state:", err);
  }

  return { synced, removed };
}

const SORT_COLUMNS = {
  title: collections.title,
  sectionTitle: collections.sectionTitle,
  childCount: collections.childCount,
  smart: collections.smart,
  labels: collections.labels,
  addedAt: collections.addedAt,
} as const;

export function getLocalCollections(filters?: CollectionFilters): { items: CollectionRow[]; total: number } {
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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(collections)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const sortCol = SORT_COLUMNS[filters?.sort as keyof typeof SORT_COLUMNS] ?? collections.title;
  const orderFn = filters?.sortDir === "desc" ? desc : asc;

  const query = db.select().from(collections).where(whereClause).orderBy(orderFn(sortCol));

  if (filters?.limit != null) {
    const items = query
      .limit(filters.limit)
      .offset(filters.offset ?? 0)
      .all();
    return { items, total };
  }

  return { items: query.all(), total };
}

export function getCollectionFilters(): { sections: { id: string; title: string }[]; labels: string[] } {
  const rows = db
    .select({ sectionId: collections.sectionId, sectionTitle: collections.sectionTitle, labels: collections.labels })
    .from(collections)
    .all();

  const sectionMap = new Map<string, string>();
  const labelSet = new Set<string>();

  for (const row of rows) {
    sectionMap.set(row.sectionId, row.sectionTitle);
    for (const l of row.labels) labelSet.add(l);
  }

  const sections = [...sectionMap.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return { sections, labels: [...labelSet].sort() };
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
  db.update(collections).set({ labels }).where(eq(collections.plexRatingKey, ratingKey)).run();
}

export async function deleteCollection(client: PlexClient, ratingKey: string): Promise<void> {
  await client.deleteItem(ratingKey);
  db.delete(collections).where(eq(collections.plexRatingKey, ratingKey)).run();
}
