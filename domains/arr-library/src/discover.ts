/**
 * "Do I already have this?" — the mirror, asked from the other direction.
 *
 * Every other query in this domain starts from a record you hold and asks what
 * it is. Discover starts from a TMDb search result you do *not* hold and asks
 * whether you do after all — which is the only thing that turns a list of
 * search results into something useful, because the answer is "yes" far more
 * often than anyone expects.
 *
 * It lives here rather than in a `domains/discover` of its own on the rule
 * this domain's header already states: it owns no tables, it is a read-model
 * over `arr_movies`, `arr_series` and `media_items`, and a read-model belongs
 * with the data it reads.
 *
 * The shape that matters is **one query per kind for a whole page of results**,
 * not one per card. A TMDb page is twenty hits; twenty round trips to SQLite
 * per keystroke is the difference between a search box and a stutter.
 */

import { and, inArray, isNull, or, type SQL } from "drizzle-orm";
import { arrMovies, arrSeries, mediaItems, type Db } from "@rube/db";

/** What Discover asks about: a TMDb id, and for a show its TVDb id if known. */
export interface DiscoverKey {
  tmdbId: number;
  mediaType: "movie" | "tv";
  /**
   * Sonarr indexes on TVDb, so this is the *real* key for a show. Optional
   * because resolving it costs a TMDb call, and the annotation is still worth
   * running without it — `arr_series.tmdbId` catches some of them.
   */
  tvdbId?: number;
}

/** One instance that holds this title. Two instances is two entries, by design. */
export interface DiscoverArrHolding {
  instanceId: string;
  arrId: number;
  monitored: boolean;
  /** Movies: `hasFile`. Series: any episode on disk. */
  hasFile: boolean;
}

export interface DiscoverHolding {
  arr: DiscoverArrHolding[];
  /** The Plex row, when `sync-media` has seen it. */
  plexRatingKey: string | null;
}

/**
 * What an external list item can be identified by.
 *
 * Both ids are optional and at least one is required in practice — a list
 * entry with neither is unmatchable and the caller should drop it rather than
 * pass it in.
 */
export interface ExternalKey {
  /** The caller's own handle for this item; the returned map is keyed on it. */
  key: string;
  mediaType: "movie" | "tv";
  tmdbId?: number | null;
  imdbId?: string | null;
}

/** `movie:603` / `tv:1396` — the key both sides of the annotation agree on. */
export function discoverKey(mediaType: "movie" | "tv", tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export function createDiscoverQueries(deps: { db: Db }) {
  const { db } = deps;

  /**
   * What you already hold, for a page of TMDb hits.
   *
   * Keyed on `media_type:tmdb_id` rather than the bare id: TMDb numbers movies
   * and shows in separate spaces, and `603` is both The Matrix and a Korean
   * drama. Collapsing them would tell somebody they already own a film they
   * have never heard of.
   */
  function annotateTmdbHits(keys: DiscoverKey[]): Map<string, DiscoverHolding> {
    const out = new Map<string, DiscoverHolding>();
    if (keys.length === 0) return out;

    const movieIds = [...new Set(keys.filter((k) => k.mediaType === "movie").map((k) => k.tmdbId))];
    const showTmdbIds = [...new Set(keys.filter((k) => k.mediaType === "tv").map((k) => k.tmdbId))];
    const showTvdbIds = [...new Set(keys.flatMap((k) => (k.mediaType === "tv" && k.tvdbId ? [k.tvdbId] : [])))];

    const holding = (key: string): DiscoverHolding => {
      const existing = out.get(key);
      if (existing) return existing;
      const created: DiscoverHolding = { arr: [], plexRatingKey: null };
      out.set(key, created);
      return created;
    };

    if (movieIds.length > 0) {
      const rows = db
        .select({
          tmdbId: arrMovies.tmdbId,
          instanceId: arrMovies.instanceId,
          arrId: arrMovies.arrId,
          monitored: arrMovies.monitored,
          hasFile: arrMovies.hasFile,
        })
        .from(arrMovies)
        // Tombstoned rows are not held. A record deleted from Radarr should
        // offer an Add button again, not claim to be there.
        .where(and(isNull(arrMovies.deletedAt), inArray(arrMovies.tmdbId, movieIds)))
        .all();
      for (const row of rows) {
        if (row.tmdbId == null) continue;
        holding(discoverKey("movie", row.tmdbId)).arr.push({
          instanceId: row.instanceId,
          arrId: row.arrId,
          monitored: row.monitored,
          hasFile: row.hasFile,
        });
      }

      const plex = db
        .select({ tmdbId: mediaItems.tmdbId, ratingKey: mediaItems.ratingKey })
        .from(mediaItems)
        .where(inArray(mediaItems.tmdbId, movieIds))
        .all();
      for (const row of plex) {
        if (row.tmdbId == null) continue;
        holding(discoverKey("movie", row.tmdbId)).plexRatingKey ??= row.ratingKey;
      }
    }

    if (showTmdbIds.length > 0 || showTvdbIds.length > 0) {
      // TVDb first: `arr_series.tmdbId` is documented as not dependable, so it
      // is the second chance rather than the key. A show matched either way is
      // the same holding, because the map is keyed on the TMDb id regardless.
      const tvdbToTmdb = new Map<number, number>();
      for (const k of keys) {
        if (k.mediaType === "tv" && k.tvdbId) tvdbToTmdb.set(k.tvdbId, k.tmdbId);
      }

      const seriesMatch: SQL[] = [];
      if (showTvdbIds.length > 0) seriesMatch.push(inArray(arrSeries.tvdbId, showTvdbIds));
      if (showTmdbIds.length > 0) seriesMatch.push(inArray(arrSeries.tmdbId, showTmdbIds));

      const rows = db
        .select({
          tmdbId: arrSeries.tmdbId,
          tvdbId: arrSeries.tvdbId,
          instanceId: arrSeries.instanceId,
          arrId: arrSeries.arrId,
          monitored: arrSeries.monitored,
          episodeFileCount: arrSeries.episodeFileCount,
        })
        .from(arrSeries)
        .where(and(isNull(arrSeries.deletedAt), or(...seriesMatch)))
        .all();

      const seen = new Set<string>();
      for (const row of rows) {
        const tmdbId = (row.tvdbId != null ? tvdbToTmdb.get(row.tvdbId) : undefined) ?? row.tmdbId;
        if (tmdbId == null) continue;
        const key = discoverKey("tv", tmdbId);
        // One series can match on both ids at once. It is still one holding.
        const dedupe = `${key}|${row.instanceId}|${row.arrId}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        holding(key).arr.push({
          instanceId: row.instanceId,
          arrId: row.arrId,
          monitored: row.monitored,
          hasFile: row.episodeFileCount > 0,
        });
      }

      const plexMatch: SQL[] = [];
      if (showTvdbIds.length > 0) plexMatch.push(inArray(mediaItems.tvdbId, showTvdbIds));
      if (showTmdbIds.length > 0) plexMatch.push(inArray(mediaItems.tmdbId, showTmdbIds));
      const plex = db
        .select({ tmdbId: mediaItems.tmdbId, tvdbId: mediaItems.tvdbId, ratingKey: mediaItems.ratingKey })
        .from(mediaItems)
        .where(or(...plexMatch))
        .all();
      for (const row of plex) {
        const tmdbId = (row.tvdbId != null ? tvdbToTmdb.get(row.tvdbId) : undefined) ?? row.tmdbId;
        if (tmdbId == null) continue;
        holding(discoverKey("tv", tmdbId)).plexRatingKey ??= row.ratingKey;
      }
    }

    return out;
  }

  /**
   * The same question, asked about an external list.
   *
   * MDBList and Trakt hand back an IMDb id for almost everything and a TMDb id
   * for most of it, and which one is missing varies item by item. Reusing
   * `annotateTmdbHits` would therefore quietly report "not held" for every
   * IMDb-only entry, which on a list of a few hundred is enough wrong answers
   * to make the preview worse than not showing one.
   *
   * The caller supplies the map key rather than it being derived, because an
   * item that carries only one of the two ids has no id pair to derive it from
   * — the list's own position is the only stable handle it has.
   */
  function annotateExternalHits(keys: ExternalKey[]): Map<string, DiscoverHolding> {
    const out = new Map<string, DiscoverHolding>();
    if (keys.length === 0) return out;

    const holding = (key: string): DiscoverHolding => {
      const existing = out.get(key);
      if (existing) return existing;
      const created: DiscoverHolding = { arr: [], plexRatingKey: null };
      out.set(key, created);
      return created;
    };

    /** id → the keys wanting it. Two list entries can name the same title. */
    function lookups(mediaType: "movie" | "tv") {
      const byTmdb = new Map<number, string[]>();
      const byImdb = new Map<string, string[]>();
      for (const k of keys) {
        if (k.mediaType !== mediaType) continue;
        if (k.tmdbId != null) byTmdb.set(k.tmdbId, [...(byTmdb.get(k.tmdbId) ?? []), k.key]);
        if (k.imdbId) byImdb.set(k.imdbId, [...(byImdb.get(k.imdbId) ?? []), k.key]);
      }
      return { byTmdb, byImdb };
    }

    /** Every key a row satisfies, deduped — a row can match on both ids at once. */
    function keysFor(
      lookup: { byTmdb: Map<number, string[]>; byImdb: Map<string, string[]> },
      row: { tmdbId?: number | null; imdbId?: string | null },
    ): string[] {
      const matched = new Set<string>();
      if (row.tmdbId != null) for (const k of lookup.byTmdb.get(row.tmdbId) ?? []) matched.add(k);
      if (row.imdbId) for (const k of lookup.byImdb.get(row.imdbId) ?? []) matched.add(k);
      return [...matched];
    }

    for (const mediaType of ["movie", "tv"] as const) {
      const lookup = lookups(mediaType);
      const tmdbIds = [...lookup.byTmdb.keys()];
      const imdbIds = [...lookup.byImdb.keys()];
      if (tmdbIds.length === 0 && imdbIds.length === 0) continue;

      const arrTable = mediaType === "movie" ? arrMovies : arrSeries;
      const match: SQL[] = [];
      if (tmdbIds.length > 0) match.push(inArray(arrTable.tmdbId, tmdbIds));
      if (imdbIds.length > 0) match.push(inArray(arrTable.imdbId, imdbIds));

      if (mediaType === "movie") {
        const rows = db
          .select({
            tmdbId: arrMovies.tmdbId,
            imdbId: arrMovies.imdbId,
            instanceId: arrMovies.instanceId,
            arrId: arrMovies.arrId,
            monitored: arrMovies.monitored,
            hasFile: arrMovies.hasFile,
          })
          .from(arrMovies)
          // Tombstoned rows are not held, same as the TMDb path.
          .where(and(isNull(arrMovies.deletedAt), or(...match)))
          .all();
        for (const row of rows) {
          for (const key of keysFor(lookup, row)) {
            holding(key).arr.push({
              instanceId: row.instanceId,
              arrId: row.arrId,
              monitored: row.monitored,
              hasFile: row.hasFile,
            });
          }
        }
      } else {
        const rows = db
          .select({
            tmdbId: arrSeries.tmdbId,
            imdbId: arrSeries.imdbId,
            instanceId: arrSeries.instanceId,
            arrId: arrSeries.arrId,
            monitored: arrSeries.monitored,
            episodeFileCount: arrSeries.episodeFileCount,
          })
          .from(arrSeries)
          .where(and(isNull(arrSeries.deletedAt), or(...match)))
          .all();
        for (const row of rows) {
          for (const key of keysFor(lookup, row)) {
            holding(key).arr.push({
              instanceId: row.instanceId,
              arrId: row.arrId,
              monitored: row.monitored,
              hasFile: row.episodeFileCount > 0,
            });
          }
        }
      }

      const plexMatch: SQL[] = [];
      if (tmdbIds.length > 0) plexMatch.push(inArray(mediaItems.tmdbId, tmdbIds));
      if (imdbIds.length > 0) plexMatch.push(inArray(mediaItems.imdbId, imdbIds));
      const plex = db
        .select({ tmdbId: mediaItems.tmdbId, imdbId: mediaItems.imdbId, ratingKey: mediaItems.ratingKey })
        .from(mediaItems)
        .where(or(...plexMatch))
        .all();
      for (const row of plex) {
        for (const key of keysFor(lookup, row)) holding(key).plexRatingKey ??= row.ratingKey;
      }
    }

    return out;
  }

  return { annotateTmdbHits, annotateExternalHits };
}
