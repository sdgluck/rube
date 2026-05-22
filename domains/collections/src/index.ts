/**
 * Collections module — sync Plex collections to local SQLite and manage them.
 */

import { eq, and, or, like, asc, desc, lt, sql, inArray, type InferSelectModel } from "drizzle-orm";
import { db, collections, collectionItems } from "@tinkerbell/db";
import { runPostCollectionSyncHook } from "@tinkerbell/core";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";

export type CollectionRow = InferSelectModel<typeof collections>;

interface SyncStats {
  synced: number;
  removed: number;
}

interface CollectionFilters {
  sectionId?: string;
  label?: string;
  /**
   * Rule id filter: matches collections labeled `Rule:<id>` OR the rating
   * key recorded as the rule's last-generated collection. The latter
   * covers smart_filter rules created by migration where the existing
   * Plex collection wasn't labeled by Tinkerbell.
   */
  ruleId?: string;
  ruleLastRatingKey?: string;
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
    smartFilter: detail.smart ? detail.content : "",
    syncedAt: now,
  };
  db.insert(collections).values(values).onConflictDoUpdate({ target: collections.plexRatingKey, set: values }).run();
  await syncCollectionMembership(client, ratingKey);
}

async function syncCollectionMembership(client: PlexClient, collectionRatingKey: string): Promise<void> {
  const children = await client.getCollectionChildren(collectionRatingKey);
  db.transaction((tx) => {
    tx.delete(collectionItems).where(eq(collectionItems.collectionRatingKey, collectionRatingKey)).run();
    if (children.length > 0) {
      tx.insert(collectionItems)
        .values(children.map((c) => ({ collectionRatingKey, itemRatingKey: c.ratingKey })))
        .run();
    }
  });
}

/** Returns the collections (local rows) that contain the given media item. */
export function getCollectionsForItem(itemRatingKey: string): CollectionRow[] {
  const memberships = db
    .select({ key: collectionItems.collectionRatingKey })
    .from(collectionItems)
    .where(eq(collectionItems.itemRatingKey, itemRatingKey))
    .all();
  if (memberships.length === 0) return [];
  return db
    .select()
    .from(collections)
    .where(
      inArray(
        collections.plexRatingKey,
        memberships.map((m) => m.key),
      ),
    )
    .all();
}

export async function syncCollections(
  client: PlexClient,
  sections: PlexSection[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<SyncStats> {
  const now = Date.now();

  let synced = 0;

  const sectionCollections: Array<{ section: PlexSection; colls: Awaited<ReturnType<PlexClient["getCollections"]>> }> =
    [];
  for (const section of sections) {
    const colls = await client.getCollections(section.key);
    sectionCollections.push({ section, colls });
  }
  const total = sectionCollections.reduce((sum, s) => sum + s.colls.length, 0);
  onProgress?.(0, total, `Syncing ${total} collection(s) across ${sections.length} section(s)...`);

  for (const { section, colls } of sectionCollections) {
    for (const col of colls) {
      const detail = await client.getCollectionDetail(col.ratingKey);

      const smartFilter = detail.smart ? detail.content : "";
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
          smartFilter,
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
            smartFilter,
            syncedAt: now,
          },
        })
        .run();

      try {
        await syncCollectionMembership(client, col.ratingKey);
      } catch {
        // Membership refresh is best-effort — a single Plex error here
        // shouldn't fail the whole sync. Leaves the prior membership rows
        // (or none) in place for this collection.
      }

      synced++;
      onProgress?.(synced, total, `Synced ${detail.title}`);
    }
  }

  // Remove stale entries in a single statement to avoid races with
  // concurrent inserts between SELECT and DELETE.
  const result = db.delete(collections).where(lt(collections.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);

  // Drop membership rows for collections that no longer exist locally.
  db.run(
    sql`DELETE FROM collection_items WHERE collection_rating_key NOT IN (SELECT plex_rating_key FROM collections)`,
  );

  // Refresh every migration provider's scan so the banner / Settings →
  // Migrate page reflects the freshly-synced state without an explicit
  // refetch. Wired via a core hook (registered by `domains/migration` at
  // startup) so this domain doesn't have to import the migration domain.
  await runPostCollectionSyncHook();

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
    // Labels are stored as a JSON-encoded array (`["foo","bar"]`). Match the
    // value with its surrounding quotes so `foo` doesn't match `foobar`.
    conditions.push(like(collections.labels, `%${JSON.stringify(filters.label)}%`));
  }

  if (filters?.ruleId) {
    // Same anchoring as `filters.label` — keep the JSON quotes so `Rule:1`
    // doesn't match `Rule:10`, `Rule:11`, etc.
    const labelMatch = like(collections.labels, `%${JSON.stringify(`Rule:${filters.ruleId}`)}%`);
    const ratingKeyMatch = filters.ruleLastRatingKey ? eq(collections.plexRatingKey, filters.ruleLastRatingKey) : null;
    conditions.push(ratingKeyMatch ? or(labelMatch, ratingKeyMatch)! : labelMatch);
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
  db.transaction((tx) => {
    tx.delete(collections).where(eq(collections.plexRatingKey, ratingKey)).run();
    tx.delete(collectionItems).where(eq(collectionItems.collectionRatingKey, ratingKey)).run();
  });
}

/**
 * Group collections labelled by the Because-You-Watched job by user. Used by
 * the jobs UI to render BYW output per Plex user. Keeps the LIKE-on-JSON
 * shape pinned in one place.
 */
export function getBywCollectionsGroupedByUser(): Array<{ user: string; collections: CollectionRow[] }> {
  const BYW_LABEL = "BecauseYouWatched";
  const rows = db
    .select()
    .from(collections)
    .where(like(collections.labels, `%"${BYW_LABEL}"%`))
    .orderBy(desc(collections.addedAt))
    .all();

  const groups = new Map<string, CollectionRow[]>();
  for (const row of rows) {
    const userLabel = row.labels.find((l) => l.startsWith("User:"));
    const key = userLabel ? userLabel.slice("User:".length) : "Server-wide";
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([user, items]) => ({ user, collections: items }))
    .sort((a, b) => {
      if (a.user === "Server-wide") return -1;
      if (b.user === "Server-wide") return 1;
      return a.user.localeCompare(b.user);
    });
}
