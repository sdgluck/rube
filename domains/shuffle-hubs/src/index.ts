/**
 * Shuffle pinned collection hubs on Plex's home for one or more sections.
 *
 * Plex doesn't expose a "reorder hubs" API directly, so the shuffle is
 * implemented as unpin-then-repin in the new order — preserving each hub's
 * promotion flags (own / recommended / shared home).
 *
 * Used by both the scheduled `shuffle` job and the Preview page button.
 */

import type { PlexClient, PlexSection } from "@tinkerbell/plex";

const COLLECTION_HUB_PREFIX = "custom.collection.";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseCollectionRatingKey(hubIdentifier: string): string | null {
  if (!hubIdentifier.startsWith(COLLECTION_HUB_PREFIX)) return null;
  const rest = hubIdentifier.slice(COLLECTION_HUB_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot < 0) return null;
  return rest.slice(dot + 1);
}

export interface ShuffleSectionResult {
  sectionTitle: string;
  shuffled: number;
  skipped: number;
}

export async function shuffleSectionHubs(
  client: PlexClient,
  section: PlexSection,
  log?: (msg: string) => void,
): Promise<ShuffleSectionResult> {
  const hubs = await client.getManagedHubs(section.key);
  const collectionHubs = hubs.filter((h) => h.identifier.startsWith(COLLECTION_HUB_PREFIX));

  if (collectionHubs.length < 2) {
    log?.(`"${section.title}" — only ${collectionHubs.length} collection hub(s), nothing to shuffle.`);
    return { sectionTitle: section.title, shuffled: 0, skipped: collectionHubs.length };
  }

  const shuffled = shuffleArray(collectionHubs);

  /** Pin one hub back, in whatever promotion state it already had. */
  const repin = async (hub: (typeof collectionHubs)[number]): Promise<boolean> => {
    const ratingKey = parseCollectionRatingKey(hub.identifier);
    if (!ratingKey) {
      log?.(`  skipping "${hub.title}" — could not parse ratingKey from ${hub.identifier}`);
      return false;
    }
    await client.pinToHomepage(section.key, ratingKey, {
      promotedToOwnHome: hub.promotedToOwnHome ?? 0,
      promotedToRecommended: hub.promotedToRecommended ?? 0,
      promotedToSharedHome: hub.promotedToSharedHome ?? 0,
    });
    return true;
  };

  // Shuffling is unpin-everything-then-pin-in-a-new-order, because Plex has no
  // "reorder" call. That leaves a window in which the home screen has no
  // collection rows at all, and this job runs every thirty minutes against a
  // server that is routinely slow or briefly unreachable — so a failure halfway
  // through used to end with eight of twelve hubs simply gone from the home
  // screen, and the next run half an hour away.
  //
  // So a failure puts back what it took down. The order will be wrong, which is
  // the whole of what shuffling was for and costs nothing; missing rows are what
  // people notice.
  const unpinned: typeof collectionHubs = [];
  // Identifiers rather than a count: `shuffled` is a permutation of the list
  // that was unpinned, so "how many have been put back" says nothing about
  // *which* are still down.
  const restored = new Set<string>();
  let pinned = 0;
  let skipped = 0;
  try {
    for (const hub of collectionHubs) {
      await client.unpinFromHomepage(section.key, hub.identifier);
      unpinned.push(hub);
    }

    for (const hub of shuffled) {
      if (await repin(hub)) pinned++;
      else skipped++;
      restored.add(hub.identifier);
    }
  } catch (err) {
    log?.(`"${section.title}" — shuffle failed partway; restoring the hubs it had.`);
    for (const hub of unpinned) {
      if (restored.has(hub.identifier)) continue;
      try {
        await repin(hub);
      } catch {
        // Best effort: one hub that cannot be restored must not stop the rest
        // from being. The original failure is what the caller hears about.
      }
    }
    throw err;
  }

  log?.(`"${section.title}" — ${pinned} hubs shuffled.`);
  return { sectionTitle: section.title, shuffled: pinned, skipped };
}
