import PQueue from "p-queue";
import { db, tmdbCache, type TmdbCachedDetails } from "@tinkerbell/db";
import { eq, inArray, sql } from "drizzle-orm";
import { fetchItemDetails, type TmdbConfig, type TmdbItemDetails } from "@tinkerbell/tmdb";
import type { JobContext } from "../../lib/job-context.ts";

/** TTL for cached entries: 30 days. Beyond this, we re-fetch on demand. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_CONCURRENCY = 8;
const PROGRESS_INTERVAL = 50;

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

  const queue = new PQueue({ concurrency: FETCH_CONCURRENCY });
  if (ctx.signal) {
    ctx.signal.addEventListener("abort", () => queue.clear(), { once: true });
  }

  let fetched = 0;
  let failed = 0;
  const insertRows: Array<typeof tmdbCache.$inferInsert> = [];

  for (const target of toFetch) {
    void queue.add(async () => {
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
    });
  }

  await queue.onIdle();
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
