import { eq, or, asc, desc, sql } from "drizzle-orm";
import { db, plexUsers, plexUserShares, plexInvites, userPreferences, likeContains } from "@tinkerbell/db";

export interface UserFilters {
  /** Narrows to a single user. Used by the detail page's cached half. */
  userId?: number;
  search?: string;
  offset?: number;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

export interface LocalUser {
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
  isOwner: boolean;
  isHome: boolean;
  isManaged: boolean;
  isProtected: boolean;
  /** False while their invite is still outstanding. */
  accepted: boolean;
  email: string | null;
  thumb: string | null;
  /** Null when the user has no share row yet — Home users often don't. */
  sharedServerId: number | null;
  /** How many libraries they can see. `null` means "every library". */
  sharedSectionCount: number | null;
}

const SORT_COLUMNS = {
  username: plexUsers.username,
  name: plexUsers.name,
  collectionCount: plexUsers.collectionCount,
  lastWatchedAt: plexUsers.lastWatchedAt,
} as const;

export function getLocalUsers(filters: UserFilters): {
  items: LocalUser[];
  total: number;
  offset: number;
  limit: number;
} {
  const conditions = [];

  if (filters.userId !== undefined) {
    conditions.push(eq(plexUsers.userId, filters.userId));
  } else if (filters.search) {
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
      isOwner: plexUsers.isOwner,
      isHome: plexUsers.isHome,
      isManaged: plexUsers.isManaged,
      isProtected: plexUsers.isProtected,
      accepted: plexUsers.accepted,
      email: plexUsers.email,
      thumb: plexUsers.thumb,
      sharedServerId: plexUsers.sharedServerId,
      sectionIds: plexUserShares.sectionIds,
      optedIn: userPreferences.optedIn,
    })
    .from(plexUsers)
    // Left, not inner: a user who has never opened the portal has no
    // preferences row and must still appear in the list. Same for a Home
    // user with no share of their own.
    .leftJoin(userPreferences, eq(userPreferences.userId, plexUsers.userId))
    .leftJoin(plexUserShares, eq(plexUserShares.userId, plexUsers.userId))
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
      isOwner: row.isOwner === 1,
      isHome: row.isHome === 1,
      isManaged: row.isManaged === 1,
      isProtected: row.isProtected === 1,
      accepted: row.accepted === 1,
      email: row.email,
      thumb: row.thumb,
      sharedServerId: row.sharedServerId,
      // An empty section list is Plex's "all libraries", which is a different
      // statement from "we have no share row for them".
      sharedSectionCount: row.sectionIds ? (row.sectionIds.length === 0 ? null : row.sectionIds.length) : null,
    })),
    total,
    offset,
    limit,
  };
}

export function getLocalUser(userId: number): LocalUser | null {
  return getLocalUsers({ userId, limit: 1 }).items[0] ?? null;
}

export function listInvites() {
  return db.select().from(plexInvites).orderBy(asc(plexInvites.username)).all();
}

export function updateUser(userId: number, updates: { name?: string | null }): void {
  db.update(plexUsers)
    .set({ name: updates.name ?? null })
    .where(eq(plexUsers.userId, userId))
    .run();
}
