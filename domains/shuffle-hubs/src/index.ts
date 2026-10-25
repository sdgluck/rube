/**
 * Order the pinned collection hubs on Plex's home for one section: shuffle
 * them, and keep the ones marked "keep at top" ahead of the rest.
 *
 * Both are done as unpin-then-repin, because re-pinning a hub appends it to
 * the end of the section's list — preserving each hub's promotion flags (own /
 * recommended / shared home). Plex does have a `move` call, but "top" here
 * means first among collection hubs rather than above Recently Added and the
 * other built-in rows, and appending is enough for that.
 *
 * "Keep at top" hubs are never taken down, by either function: everything
 * else is unpinned and re-pinned behind them. That leaves their own flags —
 * and a personal row's shared-only visibility — exactly as their owner set
 * them, and it is why a shuffle can't knock them out of place.
 *
 * Used by the scheduled `shuffle` job, the Preview page button, and the
 * `applyTopPins` step that runs after every job that pins.
 */

import type { PlexClient, PlexHub, PlexSection } from "@rube/plex";

const COLLECTION_HUB_PREFIX = "custom.collection.";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function parseCollectionRatingKey(hubIdentifier: string): string | null {
  if (!hubIdentifier.startsWith(COLLECTION_HUB_PREFIX)) return null;
  const rest = hubIdentifier.slice(COLLECTION_HUB_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot < 0) return null;
  return rest.slice(dot + 1);
}

function isKept(hub: PlexHub, keepFirst: ReadonlySet<string>): boolean {
  const ratingKey = parseCollectionRatingKey(hub.identifier);
  return ratingKey != null && keepFirst.has(ratingKey);
}

/**
 * Take `hubs` down and pin them back in `order` (a permutation of `hubs`).
 *
 * That leaves a window in which the home screen is missing those rows, and
 * this runs every thirty minutes against a server that is routinely slow or
 * briefly unreachable — so a failure halfway through used to end with eight
 * of twelve hubs simply gone from the home screen, and the next run half an
 * hour away.
 *
 * So a failure puts back what it took down. The order will be wrong, which
 * costs nothing; missing rows are what people notice.
 */
async function repinInOrder(
  client: PlexClient,
  section: PlexSection,
  hubs: PlexHub[],
  order: PlexHub[],
  log?: (msg: string) => void,
): Promise<{ pinned: number; skipped: number }> {
  /** Pin one hub back, in whatever promotion state it already had. */
  const repin = async (hub: PlexHub): Promise<boolean> => {
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

  const unpinned: PlexHub[] = [];
  // Identifiers rather than a count: `order` is a permutation of the list
  // that was unpinned, so "how many have been put back" says nothing about
  // *which* are still down.
  const restored = new Set<string>();
  let pinned = 0;
  let skipped = 0;
  try {
    for (const hub of hubs) {
      await client.unpinFromHomepage(section.key, hub.identifier);
      unpinned.push(hub);
    }

    for (const hub of order) {
      if (await repin(hub)) pinned++;
      else skipped++;
      restored.add(hub.identifier);
    }
  } catch (err) {
    log?.(`"${section.title}" — reordering failed partway; restoring the hubs it had.`);
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
  return { pinned, skipped };
}

export interface ShuffleSectionResult {
  sectionTitle: string;
  shuffled: number;
  skipped: number;
}

export interface ShuffleOptions {
  /** Rating keys of collections whose hubs stay first and out of the shuffle. */
  keepFirst?: ReadonlySet<string>;
}

export async function shuffleSectionHubs(
  client: PlexClient,
  section: PlexSection,
  log?: (msg: string) => void,
  opts: ShuffleOptions = {},
): Promise<ShuffleSectionResult> {
  const keepFirst = opts.keepFirst ?? new Set<string>();
  const hubs = await client.getManagedHubs(section.key);
  const collectionHubs = hubs.filter((h) => h.identifier.startsWith(COLLECTION_HUB_PREFIX));
  const shuffleable = collectionHubs.filter((h) => !isKept(h, keepFirst));

  if (shuffleable.length < 2) {
    log?.(`"${section.title}" — only ${shuffleable.length} collection hub(s) to shuffle, nothing to do.`);
    return { sectionTitle: section.title, shuffled: 0, skipped: shuffleable.length };
  }

  // Only the shuffleable hubs come down; re-pinning appends, so the kept ones
  // end up first whether or not they were before.
  const { pinned, skipped } = await repinInOrder(client, section, shuffleable, shuffleArray(shuffleable), log);

  log?.(`"${section.title}" — ${pinned} hubs shuffled.`);
  return { sectionTitle: section.title, shuffled: pinned, skipped };
}

/**
 * Put the `keepFirst` hubs ahead of every other collection hub in `section`.
 *
 * This runs after every job that pins, so the common case — already in order
 * — has to cost one GET and nothing else. Returns how many hubs it moved
 * behind the kept ones (0 when nothing needed doing).
 */
export async function pinFirstInSection(
  client: PlexClient,
  section: PlexSection,
  keepFirst: ReadonlySet<string>,
  log?: (msg: string) => void,
): Promise<number> {
  if (keepFirst.size === 0) return 0;
  const hubs = await client.getManagedHubs(section.key);
  const collectionHubs = hubs.filter((h) => h.identifier.startsWith(COLLECTION_HUB_PREFIX));
  const firstOther = collectionHubs.findIndex((h) => !isKept(h, keepFirst));
  if (firstOther < 0) return 0;
  const inOrder = !collectionHubs.slice(firstOther).some((h) => isKept(h, keepFirst));
  if (inOrder) return 0;

  // Everything that isn't kept comes down and goes back in its current order,
  // which lands it behind the kept hubs.
  const others = collectionHubs.filter((h) => !isKept(h, keepFirst));
  const { pinned } = await repinInOrder(client, section, others, others, log);
  log?.(`"${section.title}" — moved ${pinned} hub(s) behind the ones kept at the top.`);
  return pinned;
}
