/**
 * Collections module — sync Plex collections to local SQLite and manage them.
 */

import { getDb } from "./config.ts";
import type { PlexClient, PlexSection } from "./plex.ts";

export interface CollectionRow {
  plex_rating_key: string;
  section_id: string;
  section_title: string;
  title: string;
  summary: string;
  child_count: number;
  labels: string;
  added_at: number | null;
  thumb: string;
  synced_at: number;
}

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
  const db = getDb();
  const now = Date.now();
  const seenKeys = new Set<string>();

  const upsert = db.prepare(`
    INSERT INTO collections (plex_rating_key, section_id, section_title, title, summary, child_count, labels, added_at, thumb, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plex_rating_key) DO UPDATE SET
      section_id = excluded.section_id,
      section_title = excluded.section_title,
      title = excluded.title,
      summary = excluded.summary,
      child_count = excluded.child_count,
      labels = excluded.labels,
      added_at = excluded.added_at,
      thumb = excluded.thumb,
      synced_at = excluded.synced_at
  `);

  let synced = 0;

  for (const section of sections) {
    const collections = await client.getCollections(section.key);

    for (const col of collections) {
      const detail = await client.getCollectionDetail(col.ratingKey);
      seenKeys.add(col.ratingKey);

      upsert.run(
        col.ratingKey,
        section.key,
        section.title,
        detail.title,
        detail.summary,
        detail.childCount,
        JSON.stringify(detail.labels),
        detail.addedAt ?? null,
        detail.thumb,
        now,
      );
      synced++;
    }
  }

  // Remove stale entries
  const allRows = db.prepare("SELECT plex_rating_key FROM collections").all() as Array<{ plex_rating_key: string }>;

  let removed = 0;
  const deleteStmt = db.prepare("DELETE FROM collections WHERE plex_rating_key = ?");
  for (const row of allRows) {
    if (!seenKeys.has(row.plex_rating_key)) {
      deleteStmt.run(row.plex_rating_key);
      removed++;
    }
  }

  return { synced, removed };
}

export function getLocalCollections(filters?: CollectionFilters): CollectionRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.sectionId) {
    conditions.push("section_id = ?");
    params.push(filters.sectionId);
  }

  if (filters?.label) {
    conditions.push("labels LIKE ?");
    params.push(`%${JSON.stringify(filters.label).slice(1, -1)}%`);
  }

  if (filters?.search) {
    conditions.push("title LIKE ?");
    params.push(`%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM collections ${where} ORDER BY title`).all(...params) as unknown as CollectionRow[];
}

export function getLocalCollection(ratingKey: string): CollectionRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM collections WHERE plex_rating_key = ?").get(ratingKey) as CollectionRow | undefined;
}

export async function updateCollection(
  client: PlexClient,
  ratingKey: string,
  updates: { title?: string; summary?: string },
): Promise<void> {
  await client.updateCollection(ratingKey, updates);

  const db = getDb();
  if (updates.title !== undefined) {
    db.prepare("UPDATE collections SET title = ? WHERE plex_rating_key = ?").run(updates.title, ratingKey);
  }
  if (updates.summary !== undefined) {
    db.prepare("UPDATE collections SET summary = ? WHERE plex_rating_key = ?").run(updates.summary, ratingKey);
  }
}

export async function updateCollectionLabels(client: PlexClient, ratingKey: string, labels: string[]): Promise<void> {
  const row = getLocalCollection(ratingKey);
  if (!row) throw new Error(`Collection ${ratingKey} not found`);
  await client.setCollectionLabels(row.section_id, ratingKey, labels);
  getDb().prepare("UPDATE collections SET labels = ? WHERE plex_rating_key = ?").run(JSON.stringify(labels), ratingKey);
}

export async function deleteCollection(client: PlexClient, ratingKey: string): Promise<void> {
  await client.deleteItem(ratingKey);
  const db = getDb();
  db.prepare("DELETE FROM collections WHERE plex_rating_key = ?").run(ratingKey);
}
