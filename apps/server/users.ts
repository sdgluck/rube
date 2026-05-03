/**
 * Users module — sync Plex shared users to local SQLite and query them.
 */

import { eq, like, or, asc, desc, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { plexUsers } from "./db/schema.ts";
import { getLocalCollections } from "./collections.ts";
import type { PlexClient } from "./plex.ts";

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

  const [sharings, allCollectionsResult, accounts, history] = await Promise.all([
    client.getSharings(identity.machineIdentifier),
    Promise.resolve(getLocalCollections()),
    client.getAccounts(),
    client.getWatchHistory({ limit: 500 }),
  ]);
  const allCollections = allCollectionsResult.items;

  // Build a map of User:{username} → collection count
  const userCollectionCounts = new Map<string, number>();
  for (const col of allCollections) {
    const labels: string[] = JSON.parse(col.labels);
    for (const label of labels) {
      if (label.startsWith("User:")) {
        userCollectionCounts.set(label, (userCollectionCounts.get(label) || 0) + 1);
      }
    }
  }

  // Build a map of accountID → most recent history item
  const lastWatchedByAccount = new Map<number, { title: string; viewedAt: number }>();
  for (const item of history) {
    if (!item.accountID || !item.viewedAt) continue;
    if (!lastWatchedByAccount.has(item.accountID)) {
      const title = item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title;
      lastWatchedByAccount.set(item.accountID, { title, viewedAt: item.viewedAt });
    }
  }

  // Build maps to match sharing users to local account IDs
  const accountById = new Map(accounts.map((a) => [Number(a.id), a]));
  const accountByName = new Map(accounts.map((a) => [a.name?.toLowerCase(), a]));

  const seenIds = new Set<number>();
  let synced = 0;

  for (const s of sharings) {
    const userLabel = `User:${s.username}`;
    const account = accountById.get(s.userId) || accountByName.get(s.username.toLowerCase());
    const lastWatched = account ? lastWatchedByAccount.get(Number(account.id)) : undefined;

    seenIds.add(s.userId);

    db.insert(plexUsers)
      .values({
        userId: s.userId,
        username: s.username,
        name: null,
        label: userLabel,
        collectionCount: userCollectionCounts.get(userLabel) || 0,
        lastWatchedTitle: lastWatched?.title ?? null,
        lastWatchedAt: lastWatched?.viewedAt ?? null,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: plexUsers.userId,
        set: {
          username: s.username,
          label: userLabel,
          collectionCount: userCollectionCounts.get(userLabel) || 0,
          lastWatchedTitle: lastWatched?.title ?? null,
          lastWatchedAt: lastWatched?.viewedAt ?? null,
          syncedAt: now,
        },
      })
      .run();
    synced++;
  }

  // Remove stale entries not seen in sync
  const allRows = db.select({ userId: plexUsers.userId }).from(plexUsers).all();
  let removed = 0;
  for (const row of allRows) {
    if (!seenIds.has(row.userId)) {
      db.delete(plexUsers).where(eq(plexUsers.userId, row.userId)).run();
      removed++;
    }
  }

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
    lastWatchedAt: number | null;
  }>;
  total: number;
  offset: number;
  limit: number;
} {
  const conditions = [];

  if (filters.search) {
    conditions.push(or(like(plexUsers.username, `%${filters.search}%`), like(plexUsers.name, `%${filters.search}%`)));
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
    .select()
    .from(plexUsers)
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
      lastWatchedAt: row.lastWatchedAt,
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
