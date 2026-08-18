/**
 * Write paths for Plex user management.
 *
 * Each one makes its plex.tv call and then refreshes just that user's cached
 * rows, so the list is correct immediately rather than at the next six-hourly
 * `sync-users`. The owner is refused everywhere: Plex will not restrict or
 * unshare the account that owns the server, and letting the attempt through
 * only produces a confusing failure.
 */

import { eq } from "drizzle-orm";
import { plexUsers, plexUserShares, plexInvites, sharingRestrictionBackups, type Db } from "@tinkerbell/db";
import { setFilterClause } from "@tinkerbell/plex";
import type { PlexClient, PlexShareSettings } from "@tinkerbell/plex";
import { createQuery } from "./query.ts";

export class OwnerImmutableError extends Error {
  constructor() {
    super("The server owner's Plex access can't be changed.");
    this.name = "OwnerImmutableError";
  }
}

export class UnknownUserError extends Error {
  constructor(userId: number) {
    super(`No Plex user with id ${userId}.`);
    this.name = "UnknownUserError";
  }
}

export class NotSharedError extends Error {
  constructor(username: string) {
    super(`${username} has no share on this server to change.`);
    this.name = "NotSharedError";
  }
}

export interface InviteInput {
  email: string;
  librarySectionIds: number[];
  settings?: PlexShareSettings;
}

export async function inviteUser(client: PlexClient, { email, librarySectionIds, settings }: InviteInput) {
  const identity = await client.getIdentity();
  await client.inviteUser({
    machineIdentifier: identity.machineIdentifier,
    invitedEmail: email,
    librarySectionIds,
    settings,
  });
}

export async function createManagedUser(client: PlexClient, title: string) {
  await client.createManagedUser(title);
}

export async function addExistingUserToHome(client: PlexClient, email: string) {
  await client.addExistingUserToHome(email);
}

export interface ManageDeps {
  db: Db;
}
export function createManage(deps: ManageDeps) {
  const { getLocalUser } = createQuery(deps);

  function requireMutableUser(userId: number) {
    const user = getLocalUser(userId);
    if (!user) throw new UnknownUserError(userId);
    if (user.isOwner) throw new OwnerImmutableError();
    return user;
  }

  const { db } = deps;

  /** Re-read this one user's share from plex.tv and write it back to the cache. */
  async function refreshShare(client: PlexClient, userId: number): Promise<void> {
    const identity = await client.getIdentity();
    const shares = await client.getSharedServersFull(identity.machineIdentifier);
    const share = shares.find((s) => s.userId === userId);

    if (!share) {
      db.delete(plexUserShares).where(eq(plexUserShares.userId, userId)).run();
      db.update(plexUsers).set({ sharedServerId: null }).where(eq(plexUsers.userId, userId)).run();
      return;
    }

    const row = {
      sectionIds: share.librarySectionIds,
      allowSync: share.allowSync ? 1 : 0,
      allowTuners: share.allowTuners ? 1 : 0,
      allowChannels: share.allowChannels ? 1 : 0,
      allowCameraUpload: share.allowCameraUpload ? 1 : 0,
      filterMovies: share.filterMovies,
      filterTelevision: share.filterTelevision,
      filterMusic: share.filterMusic,
      syncedAt: Date.now(),
    };
    db.insert(plexUserShares)
      .values({ userId, ...row })
      .onConflictDoUpdate({ target: plexUserShares.userId, set: row })
      .run();
    db.update(plexUsers)
      .set({ sharedServerId: share.sharedServerId, accepted: share.accepted ? 1 : 0 })
      .where(eq(plexUsers.userId, userId))
      .run();
  }

  async function updateLibraries(client: PlexClient, userId: number, librarySectionIds: number[]) {
    const user = requireMutableUser(userId);
    if (user.sharedServerId === null) throw new NotSharedError(user.username);
    const identity = await client.getIdentity();
    await client.updateSharedSections(identity.machineIdentifier, user.sharedServerId, librarySectionIds);
    await refreshShare(client, userId);
  }

  async function updateSettings(client: PlexClient, userId: number, settings: PlexShareSettings) {
    requireMutableUser(userId);
    await client.updateShareSettings(userId, settings);
    await refreshShare(client, userId);
  }

  /**
   * Set the content-rating ceiling, preserving the `label=` clause.
   *
   * Personalization writes `label=Tinkerbell|User:<name>` into the same string;
   * composing over the live value rather than replacing it is what stops a
   * rating change from erasing those labels and blanking the user's library.
   * The backup row is updated in step so a later personalization *disable*
   * restores this choice rather than the state from before it was made.
   */
  async function updateContentRatings(
    client: PlexClient,
    userId: number,
    ratings: { movies?: string[]; television?: string[] },
  ) {
    requireMutableUser(userId);

    const identity = await client.getIdentity();
    const shares = await client.getSharedServersFull(identity.machineIdentifier);
    const share = shares.find((s) => s.userId === userId);
    if (!share) throw new NotSharedError(getLocalUser(userId)?.username ?? String(userId));

    const filterMovies =
      ratings.movies === undefined
        ? share.filterMovies
        : setFilterClause(share.filterMovies, "contentRating", ratings.movies);
    const filterTelevision =
      ratings.television === undefined
        ? share.filterTelevision
        : setFilterClause(share.filterTelevision, "contentRating", ratings.television);

    await client.updateShareSettings(userId, { filterMovies, filterTelevision });

    const backup = db
      .select()
      .from(sharingRestrictionBackups)
      .where(eq(sharingRestrictionBackups.userId, userId))
      .get();
    if (backup) {
      db.update(sharingRestrictionBackups)
        .set({
          filterMovies: setFilterClause(backup.filterMovies, "contentRating", ratings.movies ?? []),
          filterTelevision: setFilterClause(backup.filterTelevision, "contentRating", ratings.television ?? []),
        })
        .where(eq(sharingRestrictionBackups.userId, userId))
        .run();
    }

    await refreshShare(client, userId);
  }

  /**
   * `unshare` revokes this server; `unfriend` removes the Plex friendship and
   * every share that came with it. Two genuinely different acts, so the caller
   * has to say which.
   */
  async function removeUser(client: PlexClient, userId: number, mode: "unshare" | "unfriend") {
    const user = requireMutableUser(userId);

    if (mode === "unshare") {
      if (user.sharedServerId === null) throw new NotSharedError(user.username);
      const identity = await client.getIdentity();
      await client.unshareServer(identity.machineIdentifier, user.sharedServerId);
    } else {
      await client.removeFriend(userId);
      db.delete(plexUsers).where(eq(plexUsers.userId, userId)).run();
    }

    // Personalization's snapshot describes a share that no longer exists.
    // Leaving it behind would restore stale filters onto a re-invited user.
    db.delete(sharingRestrictionBackups).where(eq(sharingRestrictionBackups.userId, userId)).run();
    db.delete(plexUserShares).where(eq(plexUserShares.userId, userId)).run();
    if (mode === "unshare") {
      db.update(plexUsers).set({ sharedServerId: null }).where(eq(plexUsers.userId, userId)).run();
    }
  }

  async function cancelInvite(client: PlexClient, inviteId: number) {
    await client.cancelInvite(inviteId);
    db.delete(plexInvites).where(eq(plexInvites.id, inviteId)).run();
  }

  async function acceptInvite(client: PlexClient, inviteId: number) {
    await client.acceptInvite(inviteId);
    db.delete(plexInvites).where(eq(plexInvites.id, inviteId)).run();
  }

  async function declineInvite(client: PlexClient, inviteId: number) {
    await client.declineInvite(inviteId);
    db.delete(plexInvites).where(eq(plexInvites.id, inviteId)).run();
  }

  async function removeHomeUser(client: PlexClient, userId: number) {
    requireMutableUser(userId);
    await client.removeHomeUser(userId);
    db.delete(plexUsers).where(eq(plexUsers.userId, userId)).run();
    db.delete(plexUserShares).where(eq(plexUserShares.userId, userId)).run();
  }

  async function setUserPin(client: PlexClient, userId: number, pin: string) {
    requireMutableUser(userId);
    await client.setHomeUserPin(userId, pin);
    db.update(plexUsers).set({ isProtected: 1 }).where(eq(plexUsers.userId, userId)).run();
  }

  async function clearUserPin(client: PlexClient, userId: number) {
    requireMutableUser(userId);
    await client.clearHomeUserPin(userId);
    db.update(plexUsers).set({ isProtected: 0 }).where(eq(plexUsers.userId, userId)).run();
  }

  return {
    updateLibraries,
    updateSettings,
    updateContentRatings,
    removeUser,
    cancelInvite,
    acceptInvite,
    declineInvite,
    removeHomeUser,
    setUserPin,
    clearUserPin,
  };
}
