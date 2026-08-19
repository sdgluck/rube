import { type Services } from "@tinkerbell/composition";
import type { PlexClient } from "@tinkerbell/plex";
import type { JobContext } from "@tinkerbell/core";
import type { PlaylistActionConfig } from "@tinkerbell/contracts";

import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

/**
 * Committing a rule's selection as a playlist.
 *
 * Two things make this different from the collection path in ways worth
 * spelling out, because both are the reason playlists exist at all.
 *
 * **Order survives.** Every handler already yields an ordered list;
 * `commitCollection` discards that, because a Plex collection is a set. Here it
 * is the product. A `list_source` playlist comes out in the list's own order,
 * which is what somebody asking for "the IMDb Top 250 as a playlist" means.
 *
 * **The playlist is updated, never replaced.** Its rating key is the only
 * durable handle anyone has on it — Plex clients hold it in continue-watching
 * rows, and users pin it — so a rebuild clears and refills in place. Delete and
 * recreate would work identically from Tinkerbell's side and be quietly
 * destructive from everywhere else's.
 */

/** Marker written into the summary, so ownership survives losing the table. */
export function playlistMarker(ruleId: string): string {
  return `[tinkerbell:${ruleId}]`;
}

interface OrderableItem {
  ratingKey: string;
  title: string;
  year?: number;
}

/**
 * Apply the rule's chosen ordering.
 *
 * `handler` is the default and does nothing on purpose — the selection's own
 * order is usually the interesting one, and re-sorting it by title would throw
 * away exactly what the user wanted.
 */
export function applyOrder(items: OrderableItem[], order: PlaylistActionConfig["order"]): OrderableItem[] {
  switch (order) {
    case "handler":
      return items;
    case "title":
      return [...items].sort((a, b) => a.title.localeCompare(b.title));
    case "release_date":
      return [...items].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    case "added_date":
      // The handlers don't carry addedAt, so this is the order Plex returned
      // items in, which for a section walk is add order. Reversed for newest
      // first, which is what anybody asking for "recently added" means.
      return [...items].reverse();
    case "random": {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      return shuffled;
    }
    default:
      // A stored config from a newer build naming an order this one doesn't
      // have. Keeping the handler's order is the safe reading.
      return items;
  }
}

export function createPlaylistCommand(deps: Pick<Services, "playlists">) {
  const { getPlaylistForRule, rememberPlaylist, forgetPlaylist } = deps.playlists;

  /**
   * Drain a handler into one playlist per rule (or per section, if asked).
   *
   * Accumulates rather than committing per yield: a playlist is a single
   * ordered thing, so there's nothing to commit until the selection is
   * finished.
   */
  async function runHandlerWithPlaylist(
    deps: HandlerDeps,
    action: PlaylistActionConfig,
    machineId: string,
    handler: (d: HandlerDeps) => AsyncGenerator<PendingCollection>,
  ): Promise<{ playlistCount: number; itemCount: number }> {
    const { ctx, client, rule } = deps;

    const bySection = new Map<string, { title: string; items: OrderableItem[] }>();
    for await (const pending of handler(deps)) {
      ctx.signal?.throwIfAborted();
      // One playlist for everything is the default: playlists aren't
      // library-scoped, so a rule covering two libraries producing two
      // playlists would be a surprising thing to get.
      const key = action.combineSections ? "*" : pending.section.key;
      const name = action.playlistName?.trim() || rule.name;
      const title = action.combineSections ? name : `${name} — ${pending.section.title}`;

      const entry = bySection.get(key);
      if (entry) entry.items.push(...pending.matched);
      else bySection.set(key, { title, items: [...pending.matched] });
    }

    let playlistCount = 0;
    let itemCount = 0;

    for (const [, group] of bySection) {
      ctx.signal?.throwIfAborted();

      // De-duplicate while keeping first-seen position: the same film can be
      // in two libraries, and a playlist listing it twice is a bug from the
      // user's point of view even though the rule matched it twice.
      const seen = new Set<string>();
      const deduped = group.items.filter((i) => !seen.has(i.ratingKey) && seen.add(i.ratingKey));

      const ordered = applyOrder(deduped, action.order);
      const final = action.limit ? ordered.slice(0, action.limit) : ordered;
      if (final.length === 0) {
        ctx.log(`Nothing matched for playlist "${group.title}" — leaving it alone.`);
        continue;
      }

      const ratingKey = await commitPlaylist(ctx, client, {
        ruleId: rule.id,
        machineId,
        title: group.title,
        ratingKeys: final.map((i) => i.ratingKey),
      });
      if (ratingKey) {
        playlistCount++;
        itemCount += final.length;
      }
    }

    return { playlistCount, itemCount };
  }

  interface CommitPlaylistOptions {
    ruleId: string;
    machineId: string;
    title: string;
    ratingKeys: string[];
  }

  async function commitPlaylist(
    ctx: JobContext,
    client: PlexClient,
    opts: CommitPlaylistOptions,
  ): Promise<string | null> {
    const { ruleId, machineId, title, ratingKeys } = opts;

    const known = getPlaylistForRule(ruleId, title);
    if (known) {
      const live = await client.getPlaylist(known.ratingKey);
      if (!live) {
        // Deleted in Plex since we last looked. Forget it and fall through to
        // creating a new one rather than failing the run.
        ctx.log(`Playlist "${title}" is gone from Plex — recreating it.`);
        forgetPlaylist(known.ratingKey);
      } else {
        const current = await client.getPlaylistItems(known.ratingKey);
        const same =
          current.length === ratingKeys.length && current.every((item, i) => item.ratingKey === ratingKeys[i]);
        if (same) {
          ctx.log(`Playlist "${title}" is already exactly right (${ratingKeys.length} items) — nothing to do.`);
          return known.ratingKey;
        }

        // Clear and refill rather than delete and recreate: the rating key is
        // the handle every Plex client holds.
        await client.clearPlaylist(known.ratingKey);
        await client.addToPlaylist(known.ratingKey, machineId, ratingKeys);
        rememberPlaylist({ ratingKey: known.ratingKey, ruleId, title, itemCount: ratingKeys.length });
        ctx.log(`Updated playlist "${title}" (${current.length} → ${ratingKeys.length} items).`);
        return known.ratingKey;
      }
    }

    const created = await client.createPlaylist({ title, machineId, ratingKeys });
    if (!created) return null;

    // The marker is the fallback for a lost database: playlists can't carry
    // labels, so the summary is the only place ownership can be written where
    // Plex itself will keep it.
    await client
      .updatePlaylist(created, { summary: `Built by Tinkerbell.\n\n${playlistMarker(ruleId)}` })
      .catch(() => {});

    rememberPlaylist({ ratingKey: created, ruleId, title, itemCount: ratingKeys.length });
    ctx.log(`Created playlist "${title}" (${ratingKeys.length} items).`);
    return created;
  }

  return { runHandlerWithPlaylist, commitPlaylist };
}
