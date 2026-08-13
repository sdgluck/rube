import PQueue from "p-queue";
import { db, tmdbCache, type TmdbCachedDetails } from "@tinkerbell/db";
import { eq, inArray, sql } from "drizzle-orm";
import { fetchItemDetails, type TmdbConfig, type TmdbItemDetails } from "@tinkerbell/tmdb";
import { MONTH_MS, type JobContext } from "@tinkerbell/core";

/** TTL for cached entries: 30 days. Beyond this, we re-fetch on demand. */
const CACHE_TTL_MS = MONTH_MS;
const FETCH_CONCURRENCY = 8;
const PROGRESS_INTERVAL = 50;

/**
 * Module-scoped, so `FETCH_CONCURRENCY` is a ceiling on TMDB requests in
 * flight *in total* rather than per call. Rules run concurrently, and a
 * per-call queue would multiply the burst by the rule concurrency — TMDB
 * would see 8× that and start handing back 429s.
 */
const tmdbQueue = new PQueue({ concurrency: FETCH_CONCURRENCY });

function cacheId(tmdbId: number, mediaType: "movie" | "tv"): string {
  return `${mediaType}:${tmdbId}`;
}

function toCached(details: TmdbItemDetails): TmdbCachedDetails {
  return {
    genres: details.genres,
    productionCompanies: details.productionCompanies,
    productionCountries: details.productionCountries,
    networks: details.networks.length > 0 ? details.networks : undefined,
    cast: details.cast.length > 0 ? details.cast : undefined,
    directors: details.directors.length > 0 ? details.directors : undefined,
    contentRatings: Object.keys(details.contentRatings).length > 0 ? details.contentRatings : undefined,
    keywords: details.keywords.length > 0 ? details.keywords : undefined,
    releaseMonth: details.releaseMonth,
  };
}

/**
 * Hydrate cache for the given (tmdbId, mediaType) pairs. Reads existing rows,
 * fetches missing or stale ones, returns a Map keyed by cacheId.
 *
 * The shared cache means a single library walk is amortized across every
 * grouped TMDB rule that runs against the same section.
 */
export async function hydrateTmdbDetails(
  ctx: JobContext,
  cfg: TmdbConfig,
  pairs: Array<{ tmdbId: number; mediaType: "movie" | "tv" }>,
): Promise<Map<string, TmdbCachedDetails>> {
  if (pairs.length === 0) return new Map();

  const now = Date.now();
  const result = new Map<string, TmdbCachedDetails>();
  const ids = pairs.map((p) => cacheId(p.tmdbId, p.mediaType));

  // Read existing rows in chunks (sqlite parameter limit safeguard).
  const CHUNK = 500;
  const existing = new Map<string, { data: TmdbCachedDetails; fetchedAt: number }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await db
      .select({ id: tmdbCache.id, data: tmdbCache.data, fetchedAt: tmdbCache.fetchedAt })
      .from(tmdbCache)
      .where(inArray(tmdbCache.id, slice));
    for (const row of rows) existing.set(row.id, { data: row.data, fetchedAt: row.fetchedAt });
  }

  // Decide what to fetch.
  const toFetch: Array<{ tmdbId: number; mediaType: "movie" | "tv"; id: string }> = [];
  for (const p of pairs) {
    const id = cacheId(p.tmdbId, p.mediaType);
    const hit = existing.get(id);
    if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
      result.set(id, hit.data);
    } else {
      toFetch.push({ ...p, id });
    }
  }

  if (toFetch.length === 0) {
    ctx.log(`[tmdb-cache] all ${ids.length} item(s) hot in cache.`);
    return result;
  }

  ctx.log(`[tmdb-cache] cache hits: ${result.size}, fetching ${toFetch.length} from TMDB...`);

  let fetched = 0;
  let failed = 0;
  const insertRows: Array<typeof tmdbCache.$inferInsert> = [];

  // Awaiting our own tasks rather than `queue.onIdle()`: the queue is shared
  // with any other rule running right now, and "the queue is empty" would
  // mean waiting on their work too.
  const tasks = toFetch.map((target) =>
    tmdbQueue.add(
      async () => {
        ctx.signal?.throwIfAborted();
        try {
          const details = await fetchItemDetails(cfg, target.tmdbId, target.mediaType);
          const cached = toCached(details);
          result.set(target.id, cached);
          insertRows.push({
            id: target.id,
            tmdbId: target.tmdbId,
            mediaType: target.mediaType,
            data: cached,
            fetchedAt: now,
          });
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log(`[tmdb-cache] fetch failed for ${target.id}: ${msg}`);
        }
        fetched++;
        if (fetched % PROGRESS_INTERVAL === 0) {
          ctx.log(`[tmdb-cache] ${fetched}/${toFetch.length} fetched (${failed} failed)`);
        }
      },
      { signal: ctx.signal },
    ),
  );

  // `signal` above rejects tasks still queued when the job is cancelled, so
  // this settles promptly on abort instead of draining thousands of fetches.
  await Promise.all(tasks);
  ctx.signal?.throwIfAborted();

  // Bulk-upsert. SQLite limits ~999 bound parameters per statement; tmdb_cache
  // has 5 columns, so chunk by 100 rows = 500 params, well under the limit.
  const UPSERT_CHUNK = 100;
  for (let i = 0; i < insertRows.length; i += UPSERT_CHUNK) {
    const slice = insertRows.slice(i, i + UPSERT_CHUNK);
    await db
      .insert(tmdbCache)
      .values(slice)
      .onConflictDoUpdate({
        target: tmdbCache.id,
        set: {
          tmdbId: sql`excluded.tmdb_id`,
          mediaType: sql`excluded.media_type`,
          data: sql`excluded.data`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  ctx.log(`[tmdb-cache] fetched ${fetched - failed}, failed ${failed}, cached ${insertRows.length}.`);
  return result;
}

export { cacheId };
// Re-export for convenience.
export type { TmdbCachedDetails };

// Used by maintenance / clear-cache tooling if needed.
export async function clearTmdbCacheEntry(tmdbId: number, mediaType: "movie" | "tv"): Promise<void> {
  await db.delete(tmdbCache).where(eq(tmdbCache.id, cacheId(tmdbId, mediaType)));
}
