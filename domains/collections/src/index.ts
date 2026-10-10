/**
 * Collections module — sync Plex collections to local SQLite and manage them.
 */

import { eq, and, or, asc, desc, lt, notInArray, sql, inArray, type SQL, type InferSelectModel } from "drizzle-orm";
import { collections, collectionItems, likeContains, type Db } from "@tinkerbell/db";

import { PlexApiError, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { createArtwork } from "./artwork.ts";
import { createStats } from "./stats.ts";
import { type PostCollectionSync } from "@tinkerbell/ports";
import { token } from "@tinkerbell/container";

export type CollectionRow = InferSelectModel<typeof collections>;

export { artworkHash } from "./artwork.ts";
export type { CollectionArtworkRow } from "./artwork.ts";
export type { CollectionStats } from "./stats.ts";

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

export interface SyncCollectionsOptions {
  /**
   * Every section this install manages, whether or not this run covers it.
   *
   * The stale sweep is scoped to the sections actually walked, because this
   * mirror is not only a cache: cleanup's "never delete anything in this
   * collection" protections resolve *through* `collections` and
   * `collection_items`. A `sync-collections` job configured with
   * `sections: ["Movies"]` used to delete every TV-library collection row,
   * which quietly resolved those protections to the empty set and let a
   * cleanup rule delete items somebody had explicitly protected.
   *
   * Rows outside the managed set are still swept, so a library deleted in Plex
   * (or dropped from `global_plex_libraries`) doesn't linger. Omitted means
   * "the sections passed in are all there are".
   */
  knownSectionKeys?: readonly string[];
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

export interface DeleteCollectionResult {
  /**
   * False when Plex 404s the ratingKey — the collection was deleted on the
   * server behind our back. The local rows still go, since keeping a row for
   * something Plex doesn't have is what produced the dead entry in the first
   * place; the caller decides how to tell the user.
   */
  existedInPlex: boolean;
}

export interface CollectionsDeps {
  db: Db;
  runPostCollectionSync: PostCollectionSync;
}
export function createCollections(deps: CollectionsDeps) {
  const artwork = createArtwork(deps);
  const stats = createStats(deps);
  const { db, runPostCollectionSync } = deps;

  async function upsertCollectionByKey(client: PlexClient, section: PlexSection, ratingKey: string): Promise<void> {
    const detail = await client.getCollectionDetail(ratingKey);
    // The detail we just fetched already answers "is it smart?", so the child
    // walk doesn't need to ask Plex the same question again.
    const members = await client.getCollectionChildren(ratingKey, { smart: detail.smart });
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

  /**
   * Every distinct item ratingKey across the given collections.
   *
   * Reads the local mirror rather than Plex: the point of the caller (migration
   * verification) is to compare what Kometa built against what a Tinkerbell
   * rule *would* build, and a Plex round-trip per collection would make that a
   * slow question to ask about a hundred rules. The mirror is refreshed by the
   * collections sync, so it is as current as the last sync — which is the same
   * data the migration planned from.
   */
  function getCollectionMemberKeys(collectionRatingKeys: string[]): string[] {
    if (collectionRatingKeys.length === 0) return [];
    const rows = db
      .selectDistinct({ itemRatingKey: collectionItems.itemRatingKey })
      .from(collectionItems)
      .where(inArray(collectionItems.collectionRatingKey, collectionRatingKeys))
      .all();
    return rows.map((r) => r.itemRatingKey);
  }

  /** Returns the collections (local rows) that contain the given media item. */
  function getCollectionsForItem(itemRatingKey: string): CollectionRow[] {
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

  async function syncCollections(
    client: PlexClient,
    sections: PlexSection[],
    onProgress?: (current: number, total: number, message: string) => void,
    options: SyncCollectionsOptions = {},
  ): Promise<SyncStats> {
    const now = Date.now();

    // Phase 1: fetch everything from Plex first. If any of these awaits throws
    // (network blip, Plex outage), the whole sync aborts before we touch the
    // DB — so a partial fetch never causes the phase-2 cleanup to delete
    // collections we simply haven't restamped yet.
    const sectionCollections: Array<{
      section: PlexSection;
      colls: Awaited<ReturnType<PlexClient["getCollections"]>>;
    }> = [];
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

      const walkedKeys = sections.map((s) => s.key);
      const managedKeys = [...(options.knownSectionKeys ?? walkedKeys)];
      const result = tx
        .delete(collections)
        .where(
          or(
            and(lt(collections.syncedAt, now), inArray(collections.sectionId, walkedKeys)),
            notInArray(collections.sectionId, managedKeys),
          ),
        )
        .run();

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
    await runPostCollectionSync();

    return { synced, removed };
  }

  function getLocalCollections(filters?: CollectionFilters): { items: CollectionRow[]; total: number } {
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

  function getCollectionFilters(): { sections: { id: string; title: string }[]; labels: string[] } {
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

  function getLocalCollection(ratingKey: string): CollectionRow | undefined {
    return db.select().from(collections).where(eq(collections.plexRatingKey, ratingKey)).get();
  }

  /**
   * Titles of the collections the local mirror currently attributes to a rule.
   *
   * Read either side of a rule run to tell which collections are *new* this
   * time. Titles rather than rating keys because a run used to be
   * delete-then-recreate: every collection got a fresh rating key each night,
   * and while reconciling now keeps them stable, a rebuilt one still changes, so
   * keys can't be
   * compared across runs but names can — the same reasoning as
   * `rules.lastPinnedCollections`.
   */
  function getCollectionTitlesForRule(ruleId: string): string[] {
    // Same JSON-quote anchoring as the `ruleIds` filter, so `Rule:1` doesn't
    // match `Rule:10`.
    const rows = db
      .select({ title: collections.title })
      .from(collections)
      .where(likeContains(collections.labels, JSON.stringify(`Rule:${ruleId}`)))
      .all();
    return rows.map((r) => r.title);
  }

  async function updateCollection(
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

  async function updateCollectionLabels(client: PlexClient, ratingKey: string, labels: string[]): Promise<void> {
    const row = getLocalCollection(ratingKey);
    if (!row) throw new Error(`Collection ${ratingKey} not found`);
    await client.setCollectionLabels(row.sectionId, ratingKey, labels);
    db.update(collections).set({ labels }).where(eq(collections.plexRatingKey, ratingKey)).run();
  }

  async function deleteCollection(client: PlexClient, ratingKey: string): Promise<DeleteCollectionResult> {
    let existedInPlex = true;
    try {
      await client.deleteItem(ratingKey);
    } catch (err) {
      // A 404 means the collection is already gone from Plex — someone deleted it
      // there, or a rule run swept it — and the only thing left to do is the local
      // cleanup below. Failing the delete just stranded the row on screen.
      if (err instanceof PlexApiError && err.status === 404) {
        existedInPlex = false;
      } else if (err instanceof PlexApiError && err.status === 403) {
        // Plex refuses DELETE on /library/metadata with a bare 403 when the server
        // has "Allow media deletion" switched off, which is the default on a fresh
        // install. Nothing about the response says so, and the UI used to render
        // the whole thing as "Failed to delete" with no reason — the single most
        // likely way for this to look like a broken button rather than a setting.
        throw new Error(
          "Plex refused the delete (403). Enable Settings → Library → “Allow media deletion” on the Plex server, " +
            "and check the configured token belongs to the server owner.",
        );
      } else {
        throw err;
      }
    }
    db.transaction((tx) => {
      tx.delete(collections).where(eq(collections.plexRatingKey, ratingKey)).run();
      tx.delete(collectionItems).where(eq(collectionItems.collectionRatingKey, ratingKey)).run();
    });
    return { existedInPlex };
  }

  /**
   * Drop local rows for collections that have already been deleted from Plex.
   *
   * Jobs that delete straight through the Plex client (rule runs clearing their
   * old collections, BYW teardown, personalization sweeps) leave the cache
   * holding rows for collections the server no longer has. Nothing else prunes
   * them until the nightly `sync-collections`, so until then the Collections
   * page lists both the collection a run just deleted and the one it created to
   * replace it — which reads exactly like the run produced a duplicate.
   *
   * Returns the number of rows removed.
   */
  function forgetCollections(ratingKeys: string[]): number {
    if (ratingKeys.length === 0) return 0;
    return db.transaction((tx) => {
      const result = tx.delete(collections).where(inArray(collections.plexRatingKey, ratingKeys)).run();
      tx.delete(collectionItems).where(inArray(collectionItems.collectionRatingKey, ratingKeys)).run();
      return Number(result.changes ?? 0);
    });
  }

  /**
   * Every collection built for one specific user.
   *
   * The `User:<name>` label is what personalization uses to keep one person's
   * collections off everybody else's home screen, so it is also the honest
   * answer to "what did Tinkerbell make for me" — the portal shows exactly the
   * set the user can actually see.
   *
   * Matched on the JSON array with LIKE, the same shape `getBywCollectionsGroupedByUser`
   * uses. An exact `"User:<name>"` match including the quotes, so a user called
   * `sam` doesn't collect the collections belonging to `samantha`.
   *
   * Through `likeContains`, which escapes the pattern: a name is not a pattern,
   * and this query is a per-user boundary. A managed user called `a_b` would
   * otherwise have matched `a?b`, and one containing `%` would have matched every
   * `User:`-labelled collection on the server — including other people's.
   */
  function getCollectionsForUser(username: string): CollectionRow[] {
    return db
      .select()
      .from(collections)
      .where(likeContains(collections.labels, `"User:${username}"`))
      .orderBy(desc(collections.addedAt))
      .all();
  }

  /**
   * Group the collections a per-user AI job labelled (`BecauseYouWatched`,
   * `WeThinkYoudLike`) by user, for the job pages. Keeps the LIKE-on-JSON
   * shape pinned in one place; the label is a fixed job label, never input.
   */
  function getGeneratedCollectionsGroupedByUser(label: string): Array<{ user: string; collections: CollectionRow[] }> {
    const rows = db
      .select()
      .from(collections)
      .where(likeContains(collections.labels, `"${label}"`))
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

  function getBywCollectionsGroupedByUser() {
    return getGeneratedCollectionsGroupedByUser("BecauseYouWatched");
  }

  return {
    ...artwork,
    getGeneratedCollectionsGroupedByUser,
    ...stats,
    upsertCollectionByKey,
    getCollectionMemberKeys,
    getCollectionsForItem,
    syncCollections,
    getLocalCollections,
    getCollectionFilters,
    getLocalCollection,
    getCollectionTitlesForRule,
    updateCollection,
    updateCollectionLabels,
    deleteCollection,
    forgetCollections,
    getCollectionsForUser,
    getBywCollectionsGroupedByUser,
  };
}

export type Collections = ReturnType<typeof createCollections>;

export const CollectionsToken = token<Collections>("collections");
