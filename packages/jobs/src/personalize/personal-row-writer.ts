/**
 * Writing the one-row-per-person collections: who gets one, which existing row
 * is theirs, editing it in place, and clearing out rows nobody owns any more.
 *
 * Pick It Back Up, Finish the Franchise and Your Requests Are Here all build
 * the same kind of row — one per person per library, labelled for the job and
 * for its owner, titled so no two people's rows pool their items, kept in
 * place while it has something in it and removed when it doesn't. They used to
 * carry their own copy of each step here, and a fix to one (say, re-syncing the
 * local mirror after an edit) didn't reach the others.
 *
 * We Think You'd Like keeps its own: its rows predate per-person titles and it
 * carries a migration path for them that the rest never needed.
 */
import type { Services } from "@tinkerbell/composition";
import { errorMessage, personalRowTitle, type JobContext } from "@tinkerbell/core";
import { plexUsers, type Db } from "@tinkerbell/db";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { asc } from "drizzle-orm";
import { personalRowLabels, personalRowPin } from "./personal-row.ts";

export interface TargetUser {
  userId: number;
  username: string;
  name: string;
  isOwner: boolean;
}

export type PersonalRow = { ratingKey: string; title: string; labels: string[] };

/** Everyone on the Users page, narrowed to `allowlist` (by username or display name) when it has anything in it. */
export function targetUsers(db: Db, allowlist: string[]): TargetUser[] {
  const all = db
    .select({
      userId: plexUsers.userId,
      username: plexUsers.username,
      name: plexUsers.name,
      isOwner: plexUsers.isOwner,
    })
    .from(plexUsers)
    .orderBy(asc(plexUsers.username))
    .all()
    .map((u) => ({ userId: u.userId, username: u.username, name: u.name || u.username, isOwner: u.isOwner === 1 }));
  if (allowlist.length === 0) return all;
  const wanted = new Set(allowlist.map((u) => u.toLowerCase()));
  return all.filter((u) => wanted.has(u.username.toLowerCase()) || wanted.has(u.name.toLowerCase()));
}

/** The error a job throws when there is nobody to build for, worded for why. */
export function noUsersError(allowlist: string[]): Error {
  return new Error(
    allowlist.length > 0
      ? `No matching users found for allowlist: ${allowlist.join(", ")}`
      : "No users synced yet — run Sync users, or refresh the Users page.",
  );
}

/** Whether a row carries `label`, ignoring case — Plex hands labels back as they were first written. */
export function hasLabel(row: { labels: string[] }, label: string): boolean {
  return row.labels.some((l) => l.toLowerCase() === label.toLowerCase());
}

/**
 * This person's row in a section's listing, if they have one. `key` picks one
 * of several — More From… keeps a row per director, each labelled for whom.
 */
export function ownRow<T extends { labels: string[] }>(
  rows: T[],
  label: string,
  username: string,
  key?: string,
): T | undefined {
  return rows.find(
    (row) => hasLabel(row, label) && row.labels.some((l) => l === `User:${username}`) && (!key || hasLabel(row, key)),
  );
}

export function createPersonalRowWriter(opts: {
  client: PlexClient;
  ctx: JobContext;
  machineId: string;
  /** The job's own label, which every row it makes carries. */
  label: string;
  /** What the row is called on Home, before the per-person marks. */
  rowName: string;
  collections: Pick<Services["collections"], "upsertCollectionByKey" | "forgetCollections">;
}) {
  const { client, ctx, machineId, label, rowName, collections } = opts;

  /** Every row this job made in a section. Filtered again here because Plex's label filter is the cheap half, not the safe one. */
  async function listRows(sectionKey: string): Promise<PersonalRow[]> {
    return (await client.getCollectionsWithLabels(sectionKey, { label })).filter((row) => hasLabel(row, label));
  }

  async function deleteRow(ratingKey: string, why: string, name = rowName): Promise<void> {
    ctx.log(`Deleting "${name}" (${ratingKey}) — ${why}.`);
    await client.deleteItem(ratingKey);
    collections.forgetCollections([ratingKey]);
  }

  /**
   * Make the person's row in `section` hold exactly `ratingKeys`, in place if
   * it exists. Pinned on creation only, so a person who moved or hid it isn't
   * overruled every night; a row removed while empty is pinned again when it
   * comes back.
   *
   * `opts.key` and `opts.rowName` are for a job with several rows per person:
   * the row is found by its key label, and called `rowName`. A keyed row whose
   * title no longer matches is replaced, since a title can't be changed without
   * moving the tag every item in it carries.
   */
  async function writeRow(
    section: PlexSection,
    rows: PersonalRow[],
    user: TargetUser,
    ratingKeys: string[],
    summary: string,
    pin: boolean,
    opts: { key?: string; rowName?: string } = {},
  ): Promise<void> {
    const name = opts.rowName ?? rowName;
    const title = personalRowTitle(name, user.username);
    let existing = ownRow(rows, label, user.username, opts.key);
    if (existing && opts.rowName && existing.title !== title) {
      await deleteRow(existing.ratingKey, `rebuilding it as "${name}"`, name);
      existing = undefined;
    }
    let collectionKey: string;
    if (existing) {
      collectionKey = existing.ratingKey;
      const current = (await client.getCollectionChildren(collectionKey, { smart: false })).map((i) => i.ratingKey);
      const wanted = new Set(ratingKeys);
      const have = new Set(current);
      const add = ratingKeys.filter((k) => !have.has(k));
      const remove = current.filter((k) => !wanted.has(k));
      await client.addCollectionItems(collectionKey, machineId, add);
      for (const key of remove) await client.removeCollectionItem(collectionKey, key);
      await client.updateCollection(collectionKey, { summary });
      ctx.log(`Updated "${name}" for ${user.name}: ${add.length} added, ${remove.length} removed.`);
    } else {
      const created = await client.createCollectionWithLabel(
        section.key,
        section.type,
        machineId,
        title,
        ratingKeys,
        personalRowLabels(user.username, label, ...(opts.key ? [opts.key] : [])),
      );
      if (!created) return;
      collectionKey = created;
      await client.updateCollection(collectionKey, { summary });
      if (pin) await client.pinToHomepage(section.key, collectionKey, personalRowPin(user.isOwner));
      ctx.log(`Created "${name}" for ${user.name} (${ratingKeys.length} items).`);
    }
    try {
      await collections.upsertCollectionByKey(client, section, collectionKey);
    } catch (err) {
      ctx.log(`Failed to sync "${name}" to local DB: ${errorMessage(err)}`);
    }
  }

  /**
   * Rows for people no longer on the Users page. Call only without an
   * allowlist: narrowing it decides who gets a new row, not whose to delete.
   */
  async function sweepOrphans(rowsBySection: Iterable<PersonalRow[]>, users: TargetUser[]): Promise<void> {
    const known = new Set(users.map((u) => `User:${u.username}`));
    for (const rows of rowsBySection) {
      for (const row of rows) {
        const owner = row.labels.find((l) => l.startsWith("User:"));
        if (owner && !known.has(owner)) await deleteRow(row.ratingKey, `${owner.slice(5)} is no longer a user`);
      }
    }
  }

  return { listRows, deleteRow, writeRow, sweepOrphans };
}
