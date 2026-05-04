import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { upsertCollectionByKey } from "../../domains/collections.ts";
import type { JobContext } from "../../lib/job-context.ts";

/**
 * The full "create + pin + mirror" sequence we want for every generated
 * collection. Returns the Plex collection key, or null if creation failed.
 */
export async function commitCollection(
  ctx: JobContext,
  client: PlexClient,
  section: PlexSection,
  machineId: string,
  name: string,
  ratingKeys: string[],
  labels: string[],
  pinToHomepage: boolean,
): Promise<string | null> {
  ctx.log(`Creating "${name}" (${ratingKeys.length} items)...`);

  const collectionKey = await client.createCollectionWithLabel(
    section.key,
    section.type,
    machineId,
    name,
    ratingKeys,
    labels,
  );
  if (!collectionKey) return null;

  if (pinToHomepage) {
    await client.pinToHomepage(section.key, collectionKey, {
      promotedToOwnHome: 1,
      promotedToRecommendedHome: 1,
      promotedToSharedHome: 1,
    });
    ctx.log(`Pinned "${name}" to homepage`);
  }

  await upsertCollectionByKey(client, section, collectionKey);
  return collectionKey;
}
