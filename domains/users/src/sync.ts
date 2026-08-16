/**
 * Mirror the account's users into SQLite.
 *
 * Membership comes from `getSharings` (friends shared with *this* server,
 * plus Home users), and is then enriched from three cheap plex.tv reads so
 * the users list can render badges and share summaries without a round trip
 * per row. Anything the detail page needs to be exactly right is re-read
 * live — see `getUserDetail`.
 */

import { lt } from "drizzle-orm";
import { db, plexUsers, plexUserShares, plexInvites } from "@tinkerbell/db";
import { readLocalCollections } from "@tinkerbell/core";
import type { PlexClient, PlexUserRecord, PlexSharedServerFull } from "@tinkerbell/plex";

export interface SyncStats {
  synced: number;
  removed: number;
  invites: number;
}

export async function syncUsers(client: PlexClient): Promise<SyncStats> {
  const now = Date.now();
  const identity = await client.getIdentity();

  const [sharings, allCollectionsResult, accounts, history, owner, friends, homeUsers, shares, invites] =
    await Promise.all([
      client.getSharings(identity.machineIdentifier),
      Promise.resolve(readLocalCollections()),
      client.getAccounts(),
      client.getWatchHistory({ limit: 500 }),
      client.getOwner(),
      // The enrichment reads. Each is optional detail rather than membership,
      // so a plex.tv hiccup degrades the badges instead of emptying the list.
      client.listFriends().catch(() => [] as PlexUserRecord[]),
      client.listHomeUsers().catch(() => [] as PlexUserRecord[]),
      client.getSharedServersFull(identity.machineIdentifier).catch(() => [] as PlexSharedServerFull[]),
      client.listPendingInvites().catch(() => []),
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

  const recordById = new Map<number, PlexUserRecord>();
  for (const record of [...friends, ...homeUsers]) recordById.set(record.id, record);
  const shareByUserId = new Map(shares.map((s) => [s.userId, s]));

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
    const record = recordById.get(s.userId);
    const share = shareByUserId.get(s.userId);

    const row = {
      username: s.username,
      label: userLabel,
      collectionCount: userCollectionCounts.get(userLabel) || 0,
      lastWatchedTitle: lastWatched?.title ?? null,
      lastWatchedRatingKey: lastWatched?.ratingKey ?? null,
      lastWatchedAt: lastWatched?.viewedAt ?? null,
      isOwner: s.isOwner ? 1 : 0,
      email: record?.email || share?.email || null,
      thumb: record?.thumb || null,
      isHome: record?.home ? 1 : 0,
      isManaged: record?.restricted ? 1 : 0,
      isProtected: record?.protected ? 1 : 0,
      sharedServerId: share?.sharedServerId ?? null,
      accepted: share ? (share.accepted ? 1 : 0) : 1,
      syncedAt: now,
    };

    db.insert(plexUsers)
      .values({ userId: s.userId, name: null, ...row })
      .onConflictDoUpdate({ target: plexUsers.userId, set: row })
      .run();

    if (share) {
      const shareRow = {
        sectionIds: share.librarySectionIds,
        allowSync: share.allowSync ? 1 : 0,
        allowTuners: share.allowTuners ? 1 : 0,
        allowChannels: share.allowChannels ? 1 : 0,
        allowCameraUpload: share.allowCameraUpload ? 1 : 0,
        filterMovies: share.filterMovies,
        filterTelevision: share.filterTelevision,
        filterMusic: share.filterMusic,
        syncedAt: now,
      };
      db.insert(plexUserShares)
        .values({ userId: s.userId, ...shareRow })
        .onConflictDoUpdate({ target: plexUserShares.userId, set: shareRow })
        .run();
    }

    synced++;
  }

  for (const invite of invites) {
    const inviteRow = {
      direction: invite.direction,
      username: invite.username,
      email: invite.email,
      thumb: invite.thumb || null,
      createdAt: invite.createdAt ?? null,
      syncedAt: now,
    };
    db.insert(plexInvites)
      .values({ id: invite.id, ...inviteRow })
      .onConflictDoUpdate({ target: plexInvites.id, set: inviteRow })
      .run();
  }

  // Single bulk delete — matches the pattern in domains/collections and
  // domains/media. Avoids a SELECT + per-row DELETE loop.
  const result = db.delete(plexUsers).where(lt(plexUsers.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);
  db.delete(plexUserShares).where(lt(plexUserShares.syncedAt, now)).run();
  db.delete(plexInvites).where(lt(plexInvites.syncedAt, now)).run();

  return { synced, removed, invites: invites.length };
}
