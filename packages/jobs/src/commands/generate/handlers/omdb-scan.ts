import PQueue from "p-queue";
import type { JobContext } from "@rube/core";
import { extractImdbId, type OmdbClient, type OmdbRatings } from "@rube/omdb";

/**
 * One section's worth of OMDb lookups, shared by the rule types that read
 * OMDb (RT Top Rated, Awards) so they count and report the same way.
 *
 * The counts are the point. An OMDb-backed rule that builds little is either
 * a library OMDb has no data for or a key that hit its daily limit halfway,
 * and only the log can tell the two apart.
 */

const OMDB_CONCURRENCY = 5;
const PROGRESS_INTERVAL = 50;

export interface ScannableItem {
  ratingKey: string;
  title: string;
  year?: number;
  guids: string[];
}

export interface OmdbScanResult<T extends ScannableItem> {
  answered: Array<{ item: T; ratings: OmdbRatings }>;
  processed: number;
  cacheHits: number;
  apiCalls: number;
}

export async function scanOmdb<T extends ScannableItem>(
  ctx: JobContext,
  omdb: () => OmdbClient,
  items: readonly T[],
): Promise<OmdbScanResult<T>> {
  const answered: OmdbScanResult<T>["answered"] = [];
  const queue = new PQueue({ concurrency: OMDB_CONCURRENCY });
  if (ctx.signal) {
    ctx.signal.addEventListener("abort", () => queue.clear(), { once: true });
  }

  let processed = 0;
  let apiCalls = 0;
  let cacheHits = 0;
  let unanswered = 0;
  for (const item of items) {
    const imdbId = extractImdbId(item.guids);
    if (!imdbId) continue;

    void queue.add(async () => {
      ctx.signal?.throwIfAborted();
      const ratings = await omdb().getRatings(imdbId);
      processed++;
      if (!ratings) unanswered++;
      else if (ratings.source === "cache") cacheHits++;
      else apiCalls++;
      if (processed % PROGRESS_INTERVAL === 0) {
        ctx.log(`OMDB progress: ${processed} processed (${cacheHits} cached, ${apiCalls} fetched)...`);
      }
      if (ratings) answered.push({ item, ratings });
    });
  }

  await queue.onIdle();
  ctx.signal?.throwIfAborted();

  // A null is OMDb not knowing the title, a failed request, or the key's
  // daily limit — and the last one empties every lookup after it. Counted
  // apart from "no data", or a quota run looks like an unrated library.
  if (unanswered > 0) {
    ctx.log(
      `${unanswered} lookup(s) got no answer from OMDB (unknown title, failed request or request limit) — see Health for the reason.`,
    );
  }
  return { answered, processed, cacheHits, apiCalls };
}
