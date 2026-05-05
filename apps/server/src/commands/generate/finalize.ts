import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { upsertCollectionByKey } from "#domains/collections.ts";
import type { JobContext } from "#lib/job-context.ts";
import { fetchAutoPoster } from "#lib/posters.ts";

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
  ruleType: string,
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

  await applyAutoPoster(ctx, client, ruleType, name, collectionKey);
  await upsertCollectionByKey(client, section, collectionKey);
  return collectionKey;
}

/**
 * Best-effort poster upload from the Kometa default-images set. Failures
 * are logged but never fail the surrounding commit — coverage is patchy
 * by design and a missing poster shouldn't break a rule run.
 */
async function applyAutoPoster(
  ctx: JobContext,
  client: PlexClient,
  ruleType: string,
  name: string,
  ratingKey: string,
): Promise<void> {
  const result = await fetchAutoPoster({ ruleType, collectionName: name });

  if ("buffer" in result) {
    try {
      await client.uploadPoster(ratingKey, result.buffer);
      const tag = result.fromCache ? "cached" : "fetched";
      ctx.log(`Poster (${tag}) applied to "${name}"`);
    } catch (err) {
      ctx.log(`Poster upload failed for "${name}":`, err);
    }
    return;
  }

  if (result.status === "missing") {
    ctx.log(`No Kometa poster for "${name}" (${result.url})`);
    return;
  }

  if (result.status === "error") {
    ctx.log(`Poster fetch failed for "${name}" (${result.url}):`, result.error);
  }
}
