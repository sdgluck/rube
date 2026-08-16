/**
 * Users module — sync Plex shared users to local SQLite and query them.
 */

import { eq, or, asc, desc, lt, sql } from "drizzle-orm";
import { db, plexUsers, userPreferences, likeContains } from "@tinkerbell/db";
import { readLocalCollections } from "@tinkerbell/core";
import type { PlexClient } from "@tinkerbell/plex";

interface SyncStats {
  synced: number;
  removed: number;
}

interface UserFilters {
  search?: string;
  offset?: number;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

export async function syncUsers(client: PlexClient): Promise<SyncStats> {
  const now = Date.now();
  const identity = await client.getIdentity();

  const [sharings, allCollectionsResult, accounts, history, owner] = await Promise.all([
    client.getSharings(identity.machineIdentifier),
    Promise.resolve(readLocalCollections()),
    client.getAccounts(),
    client.getWatchHistory({ limit: 500 }),
    client.getOwner(),
  ]);
  const allCollections = allCollectionsResult.items;

  // Build a map of User:{username} → collection count
  const userCollectionCounts = new Map<string, number>();
  for (const col of allCollections) {
    for (const label of col.labels) {
      if (label.startsWith("User:")) {
        userCollectionCounts.set(label, (userCollectionCounts.get(label) || 0) + 1);
      }
    }
  }

  // Build a map of accountID → most recent history item
  const lastWatchedByAccount = new Map<number, { title: string; ratingKey: string | null; viewedAt: number }>();
  for (const item of history) {
    if (!item.accountID || !item.viewedAt) continue;
    if (!lastWatchedByAccount.has(item.accountID)) {
      const title = item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title;
      lastWatchedByAccount.set(item.accountID, { title, ratingKey: item.ratingKey ?? null, viewedAt: item.viewedAt });
    }
  }

  // Build maps to match sharing users to local account IDs
  const accountById = new Map(accounts.map((a) => [Number(a.id), a]));
  const accountByName = new Map(accounts.map((a) => [a.name?.toLowerCase(), a]));

  let synced = 0;

  const allUsers: Array<{ userId: number; username: string; isOwner?: boolean }> = sharings.map((s) => ({
    userId: s.userId,
    username: s.username,
  }));
  if (owner) allUsers.unshift({ userId: owner.id, username: owner.username, isOwner: true });

  for (const s of allUsers) {
    const userLabel = `User:${s.username}`;
    const account = accountById.get(s.userId) || accountByName.get(s.username.toLowerCase());
    const lastWatched = account ? lastWatchedByAccount.get(Number(account.id)) : undefined;

    db.insert(plexUsers)
      .values({
        userId: s.userId,
        username: s.username,
        name: null,
        label: userLabel,
        collectionCount: userCollectionCounts.get(userLabel) || 0,
        lastWatchedTitle: lastWatched?.title ?? null,
        lastWatchedRatingKey: lastWatched?.ratingKey ?? null,
        lastWatchedAt: lastWatched?.viewedAt ?? null,
        isOwner: s.isOwner ? 1 : 0,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: plexUsers.userId,
        set: {
          username: s.username,
          label: userLabel,
          collectionCount: userCollectionCounts.get(userLabel) || 0,
          lastWatchedTitle: lastWatched?.title ?? null,
          lastWatchedRatingKey: lastWatched?.ratingKey ?? null,
          lastWatchedAt: lastWatched?.viewedAt ?? null,
          isOwner: s.isOwner ? 1 : 0,
          syncedAt: now,
        },
      })
      .run();
    synced++;
  }

  // Single bulk delete — matches the pattern in domains/collections and
  // domains/media. Avoids a SELECT + per-row DELETE loop.
  const result = db.delete(plexUsers).where(lt(plexUsers.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);

  return { synced, removed };
}

const SORT_COLUMNS = {
  username: plexUsers.username,
  name: plexUsers.name,
  collectionCount: plexUsers.collectionCount,
  lastWatchedAt: plexUsers.lastWatchedAt,
} as const;

export function getLocalUsers(filters: UserFilters): {
  items: Array<{
    userId: number;
    username: string;
    name: string | null;
    label: string;
    collectionCount: number;
    lastWatchedTitle: string | null;
    lastWatchedRatingKey: string | null;
    lastWatchedAt: number | null;
    /** Whether this user opted into personalized home screens in the portal.
        No preferences row means they never did — the same reading
        `getUserPreferences` takes for a user it has never seen. */
    optedIn: boolean;
  }>;
  total: number;
  offset: number;
  limit: number;
} {
  const conditions = [];

  if (filters.search) {
    conditions.push(or(likeContains(plexUsers.username, filters.search), likeContains(plexUsers.name, filters.search)));
  }

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;

  const sortCol = SORT_COLUMNS[filters.sort as keyof typeof SORT_COLUMNS] ?? plexUsers.username;
  const orderFn = filters.sortDir === "desc" ? desc : asc;

  const whereClause = conditions.length > 0 ? conditions[0] : undefined;

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(plexUsers)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const rows = db
    .select({
      userId: plexUsers.userId,
      username: plexUsers.username,
      name: plexUsers.name,
      label: plexUsers.label,
      collectionCount: plexUsers.collectionCount,
      lastWatchedTitle: plexUsers.lastWatchedTitle,
      lastWatchedRatingKey: plexUsers.lastWatchedRatingKey,
      lastWatchedAt: plexUsers.lastWatchedAt,
      optedIn: userPreferences.optedIn,
    })
    .from(plexUsers)
    // Left, not inner: a user who has never opened the portal has no
    // preferences row and must still appear in the list.
    .leftJoin(userPreferences, eq(userPreferences.userId, plexUsers.userId))
    .where(whereClause)
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    items: rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      name: row.name,
      label: row.label,
      collectionCount: row.collectionCount,
      lastWatchedTitle: row.lastWatchedTitle,
      lastWatchedRatingKey: row.lastWatchedRatingKey,
      lastWatchedAt: row.lastWatchedAt,
      optedIn: row.optedIn === 1,
    })),
    total,
    offset,
    limit,
  };
}

export function updateUser(userId: number, updates: { name?: string | null }): void {
  db.update(plexUsers)
    .set({ name: updates.name ?? null })
    .where(eq(plexUsers.userId, userId))
    .run();
}
