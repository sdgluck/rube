/**
 * Searching TMDb for something you don't have yet.
 *
 * This is Discover's entry point, and the one part of the client that faces a
 * person typing rather than a rule running. Two things it has to get right:
 *
 * 1. `/search/multi` returns people alongside films and shows. A person result
 *    has no year, no poster we want and nothing to add to an *Arr, so they are
 *    dropped here rather than left for every caller to remember.
 * 2. **Sonarr indexes on TVDb, not TMDb.** A TMDb tv id cannot be handed to
 *    Sonarr's lookup, and TMDb does not carry the TVDb id on the search or the
 *    details response — it is a separate `/external_ids` call. Discovering that
 *    at add time, one title at a time, is the cheapest place to pay for it.
 */

import { z } from "zod";
import { tmdbFetch, yearFromDate, type TmdbConfig } from "./_shared.ts";

// ─── Response schemas ────────────────────────────────────────────────────

/**
 * One `/search/multi` row.
 *
 * Almost everything is optional because which fields are present depends on
 * `media_type`: a movie has `title`/`release_date`, a show has
 * `name`/`first_air_date`, and a person has neither.
 */
const searchResultRawSchema = z.object({
  id: z.number(),
  media_type: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  overview: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  popularity: z.number().optional(),
});

const searchMultiResponseSchema = z.object({
  page: z.number(),
  total_pages: z.number(),
  total_results: z.number().optional(),
  results: z.array(searchResultRawSchema).default([]),
});

/**
 * `/tv/{id}/external_ids`.
 *
 * `tvdb_id` is nullable and genuinely absent for a fair number of shows —
 * anything TVDb has never carried. That is a normal answer, not an error.
 */
const externalIdsResponseSchema = z.object({
  tvdb_id: z.number().nullable().optional(),
  imdb_id: z.string().nullable().optional(),
});

// ─── Public types ────────────────────────────────────────────────────────

export type TmdbMediaType = "movie" | "tv";

export interface TmdbSearchHit {
  id: number;
  mediaType: TmdbMediaType;
  title: string;
  year?: number;
  overview: string;
  /**
   * TMDb's *relative* path (`/abc.jpg`), never a full URL.
   *
   * The size belongs to whoever renders it — a grid wants `w342` and a detail
   * header wants `w500` — so baking one in here would force a re-fetch of the
   * wrong image everywhere else.
   */
  posterPath: string | null;
  popularity?: number;
}

export interface TmdbSearchPage {
  page: number;
  totalPages: number;
  results: TmdbSearchHit[];
}

export interface TmdbExternalIds {
  tvdbId: number | null;
  imdbId: string | null;
}

// ─── Public API ──────────────────────────────────────────────────────────

function isMediaType(value: string | undefined): value is TmdbMediaType {
  return value === "movie" || value === "tv";
}

/**
 * Free-text search across films and shows.
 *
 * `include_adult` defaults to false and is deliberately not plumbed through to
 * a setting: nothing in Rube asks for it, and a default that quietly
 * differs from TMDb's own is a surprise nobody asked for.
 */
export async function searchMulti(
  cfg: TmdbConfig,
  query: string,
  opts: { page?: number; includeAdult?: boolean } = {},
): Promise<TmdbSearchPage> {
  const trimmed = query.trim();
  // TMDb answers an empty `query` with a 422. There is nothing to ask about,
  // so don't spend a request finding that out.
  if (!trimmed) return { page: 1, totalPages: 0, results: [] };

  const data = await tmdbFetch(cfg, "/search/multi", searchMultiResponseSchema, {
    query: trimmed,
    page: String(opts.page ?? 1),
    include_adult: String(opts.includeAdult ?? false),
  });

  const results: TmdbSearchHit[] = [];
  for (const row of data.results) {
    if (!isMediaType(row.media_type)) continue;
    const title = row.title ?? row.name ?? "";
    // A row with no title is unrenderable and unaddable. TMDb does emit them.
    if (!title) continue;
    results.push({
      id: row.id,
      mediaType: row.media_type,
      title,
      year: yearFromDate(row.release_date ?? row.first_air_date),
      overview: row.overview ?? "",
      posterPath: row.poster_path ?? null,
      popularity: row.popularity,
    });
  }

  return { page: data.page, totalPages: data.total_pages, results };
}

/**
 * The TVDb id for a show, which is what Sonarr's lookup takes.
 *
 * Returns nulls rather than throwing when TMDb has no mapping: "Sonarr can't
 * find this show" is a message the caller can render, and an exception here
 * would be indistinguishable from TMDb being down.
 */
export async function fetchTvExternalIds(cfg: TmdbConfig, tmdbId: number): Promise<TmdbExternalIds> {
  const data = await tmdbFetch(cfg, `/tv/${tmdbId}/external_ids`, externalIdsResponseSchema);
  return { tvdbId: data.tvdb_id ?? null, imdbId: data.imdb_id ?? null };
}
