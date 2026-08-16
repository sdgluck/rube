/**
 * At-a-glance facts about one collection, answered entirely from the local
 * mirror.
 *
 * Deliberately no Plex round-trip. Everything here is already in SQLite —
 * `collection_items` holds the membership, `media_items` the runtimes, years
 * and genres, `watch_state` the plays — and the detail page renders this
 * beside a poster grid that is already waiting on several image requests. A
 * strip of numbers that arrives after the artwork is worse than one that
 * arrives with it.
 *
 * Items the media sync hasn't seen are simply absent from the join rather than
 * counted as zero: a collection whose members haven't been synced yet should
 * say "nothing to summarise", not "0 minutes".
 */

import { eq, inArray } from "drizzle-orm";
import { db, collectionItems, mediaItems, watchState } from "@tinkerbell/db";

export interface CollectionStats {
  /** Members the media sync knows about. Never more than the collection's child count. */
  knownItems: number;
  /** Summed runtime in milliseconds, over the members that report one. */
  totalRuntimeMs: number;
  /** Earliest and latest release year among members that have one. */
  yearRange: { from: number; to: number } | null;
  /** The most common genres, most frequent first, at most five. */
  topGenres: Array<{ genre: string; count: number }>;
  /**
   * Share of known members that anyone has completed at least once, 0–1.
   * `null` when nothing in the collection has a runtime or play to speak of —
   * an honest "we can't say" rather than a confident 0%.
   */
  watchedFraction: number | null;
}

const MAX_GENRES = 5;

/** How complete a play has to be before it counts as "watched". */
const WATCHED_COMPLETION_PCT = 0.9;

export function getCollectionStats(collectionRatingKey: string): CollectionStats {
  const memberKeys = db
    .select({ key: collectionItems.itemRatingKey })
    .from(collectionItems)
    .where(eq(collectionItems.collectionRatingKey, collectionRatingKey))
    .all()
    .map((r) => r.key);

  const empty: CollectionStats = {
    knownItems: 0,
    totalRuntimeMs: 0,
    yearRange: null,
    topGenres: [],
    watchedFraction: null,
  };
  if (memberKeys.length === 0) return empty;

  const rows = db
    .select({
      ratingKey: mediaItems.ratingKey,
      year: mediaItems.year,
      genres: mediaItems.genres,
      durationMs: mediaItems.durationMs,
    })
    .from(mediaItems)
    .where(inArray(mediaItems.ratingKey, memberKeys))
    .all();

  if (rows.length === 0) return empty;

  let totalRuntimeMs = 0;
  let minYear: number | null = null;
  let maxYear: number | null = null;
  const genreCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.durationMs) totalRuntimeMs += row.durationMs;
    if (row.year) {
      minYear = minYear === null ? row.year : Math.min(minYear, row.year);
      maxYear = maxYear === null ? row.year : Math.max(maxYear, row.year);
    }
    for (const genre of row.genres ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  // One row per (item, user), so an item three people finished must not count
  // three times towards "how much of this collection has been watched".
  const watchRows = db
    .select({ ratingKey: watchState.ratingKey, maxCompletionPct: watchState.maxCompletionPct })
    .from(watchState)
    .where(inArray(watchState.ratingKey, memberKeys))
    .all();
  const watched = new Set(
    watchRows.filter((r) => r.maxCompletionPct >= WATCHED_COMPLETION_PCT).map((r) => r.ratingKey),
  );

  const topGenres = [...genreCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    // Alphabetical within a tie, so the same collection doesn't reorder its
    // own genre chips between two renders of identical data.
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, MAX_GENRES);

  return {
    knownItems: rows.length,
    totalRuntimeMs,
    yearRange: minYear !== null && maxYear !== null ? { from: minYear, to: maxYear } : null,
    topGenres,
    watchedFraction: watched.size / rows.length,
  };
}
