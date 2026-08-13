/**
 * Collections module — sync Plex collections to local SQLite and manage them.
 */

import { eq, and, or, like, asc, desc, lt, sql, inArray, type SQL, type InferSelectModel } from "drizzle-orm";
import { db, collections, collectionItems, likeContains } from "@tinkerbell/db";
import { runPostCollectionSyncHook } from "@tinkerbell/core";
import { PlexApiError, type PlexClient, type PlexSection } from "@tinkerbell/plex";

export type CollectionRow = InferSelectModel<typeof collections>;

interface SyncStats {
  synced: number;
  removed: number;
}

/**
 * Value filters are lists — the page's filter controls are multi-selects.
 * Values within one filter are OR-ed; separate filters are AND-ed. Empty or
 * absent means the filter is off.
 */
interface CollectionFilters {
  sectionIds?: string[];
  labels?: string[];
  /**
   * Rule id filter: matches collections labeled `Rule:<id>` OR the rating
   * key recorded as the rule's last-generated collection. The latter
   * covers smart_filter rules created by migration where the existing
   * Plex collection wasn't labeled by Tinkerbell.
   */
  ruleIds?: string[];
  /** `ruleId` → that rule's last-generated collection rating key, where known. */
  ruleLastRatingKeys?: Record<string, string>;
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
  const members = await client.getCollectionChildren(ratingKey);
  const now = Date.now();
  const values = {
    plexRatingKey: ratingKey,
    sectionId: section.key,
    sectionTitle: section.title,
    title: detail.title,
    summary: detail.summary,
    // Plex's own `childCount` goes stale — it can sit at 0 while /children
    // serves a full list. Since we enumerate the members anyway, count those.
    childCount: members.length,
    labels: detail.labels,
    addedAt: detail.addedAt ?? null,
    thumb: detail.thumb,
    smart: detail.smart ? 1 : 0,
    smartFilter: detail.smart ? detail.content : "",
    syncedAt: now,
  };
  db.insert(collections).values(values).onConflictDoUpdate({ target: collections.plexRatingKey, set: values }).run();
  syncCollectionMembership(ratingKey, members);
}

function syncCollectionMembership(collectionRatingKey: string, children: { ratingKey: string }[]): void {
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

  // Phase 1: fetch everything from Plex first. If any of these awaits throws
  // (network blip, Plex outage), the whole sync aborts before we touch the
  // DB — so a partial fetch never causes the phase-2 cleanup to delete
  // collections we simply haven't restamped yet.
  const sectionCollections: Array<{ section: PlexSection; colls: Awaited<ReturnType<PlexClient["getCollections"]>> }> =
    [];
  for (const section of sections) {
    const colls = await client.getCollections(section.key);
    sectionCollections.push({ section, colls });
  }
  const total = sectionCollections.reduce((sum, s) => sum + s.colls.length, 0);
  onProgress?.(0, total, `Syncing ${total} collection(s) across ${sections.length} section(s)...`);

  type Detail = Awaited<ReturnType<PlexClient["getCollectionDetail"]>>;
  type Member = { ratingKey: string };
  const fetched: Array<{
    section: PlexSection;
    ratingKey: string;
    detail: Detail;
    members: Member[] | null;
  }> = [];

  let synced = 0;
  for (const { section, colls } of sectionCollections) {
    for (const col of colls) {
      const detail = await client.getCollectionDetail(col.ratingKey);
      // Membership refresh is best-effort — a single Plex error here
      // shouldn't fail the whole sync. `null` means "leave the prior
      // membership rows in place".
      let members: Member[] | null = null;
      try {
        members = await client.getCollectionChildren(col.ratingKey);
      } catch {
        members = null;
      }
      fetched.push({ section, ratingKey: col.ratingKey, detail, members });

      synced++;
      onProgress?.(synced, total, `Synced ${detail.title}`);
    }
  }

  // Phase 2: apply every write in a single transaction. Either all of the
  // upserts AND the stale-cleanup land, or none of them do.
  const removed = db.transaction((tx) => {
    for (const { section, ratingKey, detail, members } of fetched) {
      const smartFilter = detail.smart ? detail.content : "";
      // Plex's `childCount` goes stale — it can report 0 for a collection
      // whose /children endpoint happily lists 34 items. We enumerate the
      // members anyway, so count those. When the membership fetch failed we
      // keep the rows (and the count) we already had rather than trusting
      // Plex's number to overwrite a good one.
      const priorCount = tx
        .select({ count: sql<number>`count(*)` })
        .from(collectionItems)
        .where(eq(collectionItems.collectionRatingKey, ratingKey))
        .get();
      const childCount = members !== null ? members.length : priorCount?.count || detail.childCount;
      const values = {
        plexRatingKey: ratingKey,
        sectionId: section.key,
        sectionTitle: section.title,
        title: detail.title,
        summary: detail.summary,
        childCount,
        labels: detail.labels,
        addedAt: detail.addedAt ?? null,
        thumb: detail.thumb,
        smart: detail.smart ? 1 : 0,
        smartFilter,
        syncedAt: now,
      };
      tx.insert(collections)
        .values(values)
        .onConflictDoUpdate({ target: collections.plexRatingKey, set: values })
        .run();

      if (members !== null) {
        tx.delete(collectionItems).where(eq(collectionItems.collectionRatingKey, ratingKey)).run();
        if (members.length > 0) {
          tx.insert(collectionItems)
            .values(members.map((m) => ({ collectionRatingKey: ratingKey, itemRatingKey: m.ratingKey })))
            .run();
        }
      }
    }

    const result = tx.delete(collections).where(lt(collections.syncedAt, now)).run();

    // Drop membership rows for collections that no longer exist locally.
    tx.run(
      sql`DELETE FROM collection_items WHERE collection_rating_key NOT IN (SELECT plex_rating_key FROM collections)`,
    );

    return Number(result.changes ?? 0);
  });

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

/** `or()` over a list that may hold a single term, where `or()` is a no-op. */
function orAll(terms: SQL[]): SQL {
  return terms.length === 1 ? terms[0] : or(...terms)!;
}

export function getLocalCollections(filters?: CollectionFilters): { items: CollectionRow[]; total: number } {
  const conditions = [];

  const sectionIds = filters?.sectionIds ?? [];
  if (sectionIds.length > 0) {
    conditions.push(
      sectionIds.length === 1 ? eq(collections.sectionId, sectionIds[0]) : inArray(collections.sectionId, sectionIds),
    );
  }

  const labels = filters?.labels ?? [];
  if (labels.length > 0) {
    // Labels are stored as a JSON-encoded array (`["foo","bar"]`). Match each
    // value with its surrounding quotes so `foo` doesn't match `foobar`.
    conditions.push(orAll(labels.map((label) => likeContains(collections.labels, JSON.stringify(label)))));
  }

  const ruleIds = filters?.ruleIds ?? [];
  if (ruleIds.length > 0) {
    // Same anchoring as the label filter — keep the JSON quotes so `Rule:1`
    // doesn't match `Rule:10`, `Rule:11`, etc.
    conditions.push(
      orAll(
        ruleIds.map((ruleId) => {
          const labelMatch = likeContains(collections.labels, JSON.stringify(`Rule:${ruleId}`));
          const lastRatingKey = filters?.ruleLastRatingKeys?.[ruleId];
          return lastRatingKey ? or(labelMatch, eq(collections.plexRatingKey, lastRatingKey))! : labelMatch;
        }),
      ),
    );
  }

  if (filters?.search) {
    conditions.push(likeContains(collections.title, filters.search));
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
  try {
    await client.deleteItem(ratingKey);
  } catch (err) {
    // Plex refuses DELETE on /library/metadata with a bare 403 when the server
    // has "Allow media deletion" switched off, which is the default on a fresh
    // install. Nothing about the response says so, and the UI used to render
    // the whole thing as "Failed to delete" with no reason — the single most
    // likely way for this to look like a broken button rather than a setting.
    if (err instanceof PlexApiError && err.status === 403) {
      throw new Error(
        "Plex refused the delete (403). Enable Settings → Library → “Allow media deletion” on the Plex server, " +
          "and check the configured token belongs to the server owner.",
      );
    }
    throw err;
  }
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
