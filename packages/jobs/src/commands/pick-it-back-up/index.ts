/**
 * Pick It Back Up: one collection per person per TV library, of the shows
 * they started and stopped watching partway through.
 *
 * Plex's Continue Watching only holds what someone watched lately, so a show
 * they drifted away from three weeks ago — with the next episode sitting
 * there — drops out of sight. This puts it back on their Home.
 *
 * It sits beside Because You Watched and We Think You'd Like and builds its
 * rows the same way (`personal-row.ts`: their own label, their own Home,
 * their own title), but it asks no model. What someone was halfway through
 * is a fact in the playback log, not a taste to be guessed at.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **A window, not a threshold.** Played in the last `stallDays` means
 *    still watching — Continue Watching has it. Not played for `maxStallDays`
 *    means they dropped it, and a row nagging about a show someone quit a
 *    year ago is the row they'd hide.
 *  - **A sampled pilot is not a started show.** Fewer than `minEpisodes`
 *    finished episodes is left out.
 *  - **The row is edited in place**, keeping its pin and wherever the person
 *    moved it — like WTYL — but **removed when it's empty**. Unlike a taste,
 *    there is nothing stale worth keeping: a show they've picked back up
 *    doesn't belong in it, and an empty row on someone's Home is noise.
 */
import { PIBU_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { displayTitle, errorMessage, personalRowTitle } from "@tinkerbell/core";
import type { JobContext, PibuJobConfig } from "@tinkerbell/core";
import { createPlexClient, type PlexClient, type PlexLeaf, type PlexSection } from "@tinkerbell/plex";
import { asc, eq, inArray, and } from "drizzle-orm";
import { mediaItems, plexUsers } from "@tinkerbell/db";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { personalRowLabels, personalRowPin } from "../../personalize/personal-row.ts";
import { historyUserIds } from "../we-think-youd-like/profile.ts";
import { episodeCode, pickUpPoint, pickUpSummary, stalledShows, type PickUpPoint } from "./stalled.ts";

export const PIBU_LABEL = "PickItBackUp";
export const PIBU_ROW_NAME = "Pick It Back Up";

interface TargetUser {
  userId: number;
  username: string;
  name: string;
  isOwner: boolean;
}

interface SectionState {
  section: PlexSection;
  rows: Array<{ ratingKey: string; title: string; labels: string[] }>;
}

/** This person's row in a section's listing, if they have one. */
export function ownPibuRow<T extends { labels: string[] }>(rows: T[], username: string): T | undefined {
  return rows.find(
    (row) =>
      row.labels.some((l) => l.toLowerCase() === PIBU_LABEL.toLowerCase()) &&
      row.labels.some((l) => l === `User:${username}`),
  );
}

export function createPickItBackUpCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "db" | "preferences">,
) {
  const { clients, collections, config, db, preferences } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;
  const { upsertCollectionByKey, forgetCollections } = collections;

  function targetUsers(allowlist: string[]): TargetUser[] {
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

  /** The index's shows among `keys`: which library each is in, and its title. */
  function showsByKey(keys: string[]): Map<string, { title: string; sectionId: string }> {
    const out = new Map<string, { title: string; sectionId: string }>();
    for (let i = 0; i < keys.length; i += 500) {
      for (const row of db
        .select({ ratingKey: mediaItems.ratingKey, title: mediaItems.title, sectionId: mediaItems.sectionId })
        .from(mediaItems)
        .where(and(inArray(mediaItems.ratingKey, keys.slice(i, i + 500)), eq(mediaItems.type, "show")))
        .all()) {
        out.set(row.ratingKey, { title: row.title, sectionId: row.sectionId });
      }
    }
    return out;
  }

  async function deleteRow(client: PlexClient, ctx: JobContext, ratingKey: string, why: string): Promise<void> {
    ctx.log(`Deleting "${PIBU_ROW_NAME}" (${ratingKey}) — ${why}.`);
    await client.deleteItem(ratingKey);
    forgetCollections([ratingKey]);
  }

  /** Make the person's row hold exactly `ratingKeys`, editing it in place if it exists. */
  async function writeRow(
    client: PlexClient,
    ctx: JobContext,
    machineId: string,
    state: SectionState,
    user: TargetUser,
    ratingKeys: string[],
    summary: string,
    pin: boolean,
  ): Promise<void> {
    const { section } = state;
    const existing = ownPibuRow(state.rows, user.username);
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
      ctx.log(`Updated "${PIBU_ROW_NAME}" for ${user.name}: ${add.length} added, ${remove.length} removed.`);
    } else {
      const created = await client.createCollectionWithLabel(
        section.key,
        section.type,
        machineId,
        personalRowTitle(PIBU_ROW_NAME, user.username),
        ratingKeys,
        personalRowLabels(user.username, PIBU_LABEL),
      );
      if (!created) return;
      collectionKey = created;
      await client.updateCollection(collectionKey, { summary });
      // Pinned on creation only, so a person who moved or hid it isn't overruled
      // every night. A row removed while empty is pinned again when it returns.
      if (pin) await client.pinToHomepage(section.key, collectionKey, personalRowPin(user.isOwner));
      ctx.log(`Created "${PIBU_ROW_NAME}" for ${user.name} (${ratingKeys.length} shows).`);
    }
    try {
      await upsertCollectionByKey(client, section, collectionKey);
    } catch (err) {
      ctx.log(`Failed to sync "${PIBU_ROW_NAME}" to local DB: ${errorMessage(err)}`);
    }
  }

  async function run(ctx: JobContext, config: PibuJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const stallDays = config.stallDays ?? PIBU_DEFAULTS.stallDays;
    const maxStallDays = config.maxStallDays ?? PIBU_DEFAULTS.maxStallDays;
    const minEpisodes = config.minEpisodes ?? PIBU_DEFAULTS.minEpisodes;
    const maxItems = config.maxItems ?? PIBU_DEFAULTS.maxItems;
    const pin = config.pinToHomepage ?? PIBU_DEFAULTS.pinToHomepage;
    const allowlist = config.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    if (stallDays >= maxStallDays) {
      throw new Error(
        `"Stopped after" (${stallDays} days) has to be shorter than "Given up after" (${maxStallDays} days).`,
      );
    }
    const users = targetUsers(allowlist);
    if (users.length === 0) {
      throw new Error(
        allowlist.length > 0
          ? `No matching users found for allowlist: ${allowlist.join(", ")}`
          : "No users synced yet — run Sync users, or refresh the Users page.",
      );
    }
    const retention = getConfig("playback_retention_days") ?? 0;
    if (retention > 0 && retention < maxStallDays) {
      ctx.log(
        `"Given up after" is ${maxStallDays} days, but playback retention keeps ${retention}; reading ${retention}.`,
      );
    }

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell pick-it-back-up`);
    ctx.log(`Server: ${url}`);
    const machineId = (await client.getIdentity()).machineIdentifier;
    ctx.log(`Users: ${users.map((u) => u.name).join(", ")}`);
    ctx.log(
      `Stopped: not played for ${stallDays}–${maxStallDays} days, with at least ${minEpisodes} episode(s) finished.`,
    );

    // TV libraries only: a film can't be half-watched across nights the way a
    // show is, and Continue Watching already holds a paused film.
    const sections = new Map<string, SectionState>();
    for (const section of await resolveTargetSections(client, getConfig, config.sections)) {
      if (section.type !== "show") continue;
      const rows = (await client.getCollectionsWithLabels(section.key, { label: PIBU_LABEL })).filter((row) =>
        row.labels.some((l) => l.toLowerCase() === PIBU_LABEL.toLowerCase()),
      );
      sections.set(section.key, { section, rows });
      ctx.log(`"${section.title}": ${rows.length} existing row(s).`);
    }
    if (sections.size === 0) {
      ctx.log("No TV library to build in.");
      return;
    }

    // One episode list per show, however many people stopped watching it.
    const leavesByShow = new Map<string, Promise<PlexLeaf[] | null>>();
    const leavesOf = (showKey: string) => {
      let pending = leavesByShow.get(showKey);
      if (!pending) {
        pending = client.showLeaves(showKey).catch((err) => {
          if (ctx.signal.aborted) throw err;
          ctx.log(`Couldn't read the episodes of show ${showKey}: ${errorMessage(err)}; leaving it out.`);
          return null;
        });
        leavesByShow.set(showKey, pending);
      }
      return pending;
    };

    const now = Date.now();
    for (const [i, user] of users.entries()) {
      ctx.progress(i, users.length, user.name);
      const prefs = getOptedInPreferencesByUsername(user.username);
      // "Not for me" in the portal names the row: take it away and stop making it.
      const declined = (prefs?.excludedCollections ?? []).some(
        (t) => displayTitle(t).toLowerCase() === PIBU_ROW_NAME.toLowerCase(),
      );
      if (declined) {
        for (const state of sections.values()) {
          const existing = ownPibuRow(state.rows, user.username);
          if (existing) await deleteRow(client, ctx, existing.ratingKey, `${user.name} said it wasn't for them`);
        }
        continue;
      }

      const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
      const stalled = stalledShows(db, historyUserIds(user), now, { stallDays, maxStallDays });
      const shows = showsByKey(stalled.map((s) => s.showKey));
      const picks = new Map<string, Array<{ showKey: string; title: string; point: PickUpPoint }>>();
      for (const show of stalled) {
        const meta = shows.get(show.showKey);
        // Not in the index any more (deleted), not a library this job builds
        // in, or a title they asked never to be shown.
        if (!meta || !sections.has(meta.sectionId) || excluded.has(meta.title.toLowerCase())) continue;
        const bucket = picks.get(meta.sectionId) ?? [];
        if (bucket.length >= maxItems) continue;
        const leaves = await leavesOf(show.showKey);
        if (!leaves) continue;
        const point = pickUpPoint(leaves, show.plays);
        if (!point || point.finished < minEpisodes) continue;
        bucket.push({ showKey: show.showKey, title: meta.title, point });
        picks.set(meta.sectionId, bucket);
      }

      for (const state of sections.values()) {
        const mine = picks.get(state.section.key) ?? [];
        const existing = ownPibuRow(state.rows, user.username);
        const where = `${user.name} — "${state.section.title}"`;
        if (mine.length === 0) {
          ctx.log(`${where}: nothing to pick back up.`);
          if (existing) await deleteRow(client, ctx, existing.ratingKey, "nothing left in it");
          continue;
        }
        ctx.log(
          `${where}: ${mine
            .map(
              (p) =>
                `${p.title} (${p.point.resume ? "resume" : "next"} ${episodeCode(p.point.next)}, ${p.point.remaining} left)`,
            )
            .join("; ")}.`,
        );
        await writeRow(
          client,
          ctx,
          machineId,
          state,
          user,
          mine.map((p) => p.showKey),
          pickUpSummary(mine),
          pin,
        );
      }
    }

    // Rows for people no longer on the Users page. Not with an allowlist set:
    // narrowing it decides who gets a new row, not whose to delete.
    if (allowlist.length === 0) {
      const known = new Set(users.map((u) => `User:${u.username}`));
      for (const state of sections.values()) {
        for (const row of state.rows) {
          const owner = row.labels.find((l) => l.startsWith("User:"));
          if (owner && !known.has(owner))
            await deleteRow(client, ctx, row.ratingKey, `${owner.slice(5)} is no longer a user`);
        }
      }
    }

    ctx.progress(users.length, users.length, "Done");
    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: PibuJobConfig): Promise<void> {
  return createPickItBackUpCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
