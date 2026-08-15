import PQueue from "p-queue";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { upsertCollectionByKey } from "@tinkerbell/domain.collections";
import type { JobContext } from "@tinkerbell/core";
import { fetchAutoPoster } from "@tinkerbell/core";
import { bufferLog } from "./log-buffer.ts";

/**
 * How many collections may be committed at once. Each commit is five-odd
 * Plex round-trips (create, label, optional pin, poster upload, detail +
 * children for the local mirror), and a grouped rule can produce hundreds
 * of them — run one at a time, latency dominates the whole job.
 */
export const COMMIT_CONCURRENCY = 6;

/**
 * Module-scoped, so `COMMIT_CONCURRENCY` caps the writes one Plex server sees
 * *in total* rather than per rule. Rules run concurrently too, and a per-rule
 * queue would multiply the burst by the rule concurrency — which on a home
 * server is how you turn a generate run into a stalled Plex.
 */
const commitQueue = new PQueue({ concurrency: COMMIT_CONCURRENCY });

/**
 * The full "create + pin + mirror" sequence we want for every generated
 * collection. Returns the Plex collection key, or null if creation failed.
 *
 * Commits run concurrently, so this collection's log lines are buffered and
 * emitted as one block — otherwise six collections' progress braids together
 * and the job log becomes unreadable.
 */
export async function commitCollection(
  jobCtx: JobContext,
  client: PlexClient,
  section: PlexSection,
  machineId: string,
  name: string,
  ratingKeys: string[],
  labels: string[],
  pinToHomepage: boolean,
  ruleType: string,
): Promise<string | null> {
  const { ctx, flush } = bufferLog(jobCtx);
  try {
    return await commitQueue.add(async () => {
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
    });
  } finally {
    flush();
  }
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
