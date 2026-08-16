import PQueue from "p-queue";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { getCollectionArtwork, recordCollectionArtwork, upsertCollectionByKey } from "@tinkerbell/domain.collections";
import type { JobContext } from "@tinkerbell/core";
import { fetchAutoPoster } from "@tinkerbell/core";
import {
  resolveCollectionSummary,
  resolvePresentation,
  type PresentationConfig,
  type RuleConfig,
} from "@tinkerbell/contracts";
import { bufferLog } from "./log-buffer.ts";
import { tagResolverFor } from "./tag-labels.ts";

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

export interface CommitCollectionOptions {
  section: PlexSection;
  machineId: string;
  name: string;
  ratingKeys: string[];
  labels: string[];
  pinToHomepage: boolean;
  ruleType: string;
  /**
   * Set for a rule's own collections; absent for the cleanup queue shelf,
   * which belongs to no rule's presentation config and gets no summary.
   */
  ruleId?: string;
  ruleConfig?: RuleConfig;
  /**
   * A description the source itself supplied — TMDb ships an overview with
   * every franchise, and it outranks anything a template would assemble.
   */
  sourceSummary?: string;
}

/**
 * The full "create + pin + describe + mirror" sequence we want for every
 * generated collection. Returns the Plex collection key, or null if creation
 * failed.
 *
 * Commits run concurrently, so this collection's log lines are buffered and
 * emitted as one block — otherwise six collections' progress braids together
 * and the job log becomes unreadable.
 */
export async function commitCollection(
  jobCtx: JobContext,
  client: PlexClient,
  opts: CommitCollectionOptions,
): Promise<string | null> {
  const { ctx, flush } = bufferLog(jobCtx);
  const { section, name, ratingKeys } = opts;
  try {
    return await commitQueue.add(async () => {
      ctx.log(`Creating "${name}" (${ratingKeys.length} items)...`);

      const collectionKey = await client.createCollectionWithLabel(
        section.key,
        section.type,
        opts.machineId,
        name,
        ratingKeys,
        opts.labels,
      );
      if (!collectionKey) return null;

      if (opts.pinToHomepage) {
        await client.pinToHomepage(section.key, collectionKey, {
          promotedToOwnHome: 1,
          promotedToRecommendedHome: 1,
          promotedToSharedHome: 1,
        });
        ctx.log(`Pinned "${name}" to homepage`);
      }

      await applySummary(ctx, client, collectionKey, opts);
      await applyAutoPoster(ctx, client, opts, collectionKey);
      await upsertCollectionByKey(client, section, collectionKey);
      return collectionKey;
    });
  } finally {
    flush();
  }
}

/**
 * Write the deterministic summary, if the rule has one to write.
 *
 * Deliberately inline rather than deferred to `collection-art`: it is a single
 * PUT with no CPU behind it, and a collection that gains its description the
 * moment it is created is the whole difference the feature makes. The
 * expensive halves — LLM-written summaries and poster rendering — are what the
 * separate command exists for.
 */
async function applySummary(
  ctx: JobContext,
  client: PlexClient,
  ratingKey: string,
  opts: CommitCollectionOptions,
): Promise<void> {
  if (!opts.ruleId) return;
  const presentation: PresentationConfig = resolvePresentation(opts.ruleConfig);

  const resolveTag = await tagResolverFor(client, opts.section.key, opts.ruleConfig?.smartFilter);
  const resolved = resolveCollectionSummary(presentation, {
    ruleType: opts.ruleType,
    collectionName: opts.name,
    sectionType: opts.section.type,
    itemCount: opts.ratingKeys.length,
    sourceSummary: opts.sourceSummary,
    config: opts.ruleConfig,
    resolveTag,
  });
  if (!resolved) return;

  // A summary somebody edited by hand is theirs. `collection-art` is what
  // notices the edit and sets the lock; this is where the lock is honoured, so
  // the nightly run stops overwriting it from the very next run onward.
  const ledger = getCollectionArtwork(opts.ruleId, opts.name);
  if (ledger?.summaryLockedAt) {
    ctx.log(`Summary for "${opts.name}" was edited in Plex — leaving it alone.`);
    return;
  }

  try {
    await client.updateCollection(ratingKey, { summary: resolved.text });
    recordCollectionArtwork(opts.ruleId, opts.name, { summary: resolved.text, summarySource: resolved.source });
  } catch (err) {
    // A description is a nicety; failing to set one must not fail the commit.
    ctx.log(`Summary update failed for "${opts.name}":`, err);
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
  opts: CommitCollectionOptions,
  ratingKey: string,
): Promise<void> {
  // A rule that generates its own artwork gets it from `collection-art`.
  // Uploading a Kometa poster here as well would mean two uploads per
  // collection per run, the second one silently replacing the first.
  if (resolvePresentation(opts.ruleConfig).poster !== "none") return;

  const result = await fetchAutoPoster({ ruleType: opts.ruleType, collectionName: opts.name });
  const name = opts.name;

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
