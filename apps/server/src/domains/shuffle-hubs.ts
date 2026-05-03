/**
 * Shuffle pinned collection hubs on Plex's home for one or more sections.
 *
 * Plex doesn't expose a "reorder hubs" API directly, so the shuffle is
 * implemented as unpin-then-repin in the new order — preserving each hub's
 * promotion flags (own / recommended / shared home).
 *
 * Used by both the scheduled `shuffle` job and the Preview page button.
 */

import type { PlexClient, PlexSection } from "../clients/plex.ts";

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

  for (const hub of collectionHubs) {
    await client.unpinFromHomepage(section.key, hub.identifier);
  }

  let pinned = 0;
  let skipped = 0;
  for (const hub of shuffled) {
    const ratingKey = parseCollectionRatingKey(hub.identifier);
    if (!ratingKey) {
      log?.(`  skipping "${hub.title}" — could not parse ratingKey from ${hub.identifier}`);
      skipped++;
      continue;
    }
    await client.pinToHomepage(section.key, ratingKey, {
      promotedToOwnHome: hub.promotedToOwnHome ?? 0,
      promotedToRecommendedHome: hub.promotedToRecommendedHome ?? 0,
      promotedToSharedHome: hub.promotedToSharedHome ?? 0,
    });
    pinned++;
  }

  log?.(`"${section.title}" — ${pinned} hubs shuffled.`);
  return { sectionTitle: section.title, shuffled: pinned, skipped };
}

export async function shuffleAllSections(
  client: PlexClient,
  sections: PlexSection[],
  log?: (msg: string) => void,
  progress?: (current: number, total: number, msg: string) => void,
): Promise<ShuffleSectionResult[]> {
  const results: ShuffleSectionResult[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    progress?.(i + 1, sections.length, `Shuffling "${section.title}"...`);
    results.push(await shuffleSectionHubs(client, section, log));
  }
  return results;
}
