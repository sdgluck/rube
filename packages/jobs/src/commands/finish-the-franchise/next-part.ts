/**
 * Which film in a series someone should watch next, and what they've watched.
 *
 * Kept apart from the command so the decisions — what counts as finished,
 * which part is "next", what to do about a gap — can be tested without Plex
 * or TMDb.
 */
import { arrMovies, mediaItems, watchState, type Db } from "@rube/db";
import type { TmdbCollectionPart } from "@rube/tmdb";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

/** Watched this far through counts as seen — the same line Pick It Back Up and We Think You'd Like draw. */
export const FINISHED_AT = 0.8;

export interface WatchedFilm {
  tmdbId: number;
  finished: boolean;
  /** Started but not finished: the next part can be a resume rather than a start. */
  started: boolean;
  lastPlayedAt: number;
}

/**
 * Every film these accounts have played, by TMDb id.
 *
 * By TMDb id rather than rating key so a 4K copy and the 1080p one are one
 * film. A film cleanup has since deleted is no longer in the library index,
 * so its TMDb id comes from Radarr's record of it, which outlives the file —
 * without that, deleting Alien after watching it would make Aliens look like
 * the start of the series.
 */
export function watchedFilms(db: Db, userIds: number[]): Map<number, WatchedFilm> {
  const out = new Map<number, WatchedFilm>();
  if (userIds.length === 0) return out;
  const rows = db
    .select({
      tmdbId: sql<number | null>`coalesce(${mediaItems.tmdbId}, ${arrMovies.tmdbId})`,
      completedPlays: watchState.completedPlays,
      maxCompletionPct: watchState.maxCompletionPct,
      lastPlayedAt: watchState.lastPlayedAt,
    })
    .from(watchState)
    .leftJoin(mediaItems, eq(mediaItems.ratingKey, watchState.ratingKey))
    .leftJoin(arrMovies, eq(arrMovies.plexRatingKey, watchState.ratingKey))
    .where(
      and(
        inArray(watchState.userId, userIds),
        or(eq(mediaItems.type, "movie"), and(isNull(mediaItems.ratingKey), sql`${arrMovies.tmdbId} is not null`)),
      ),
    )
    .all();
  for (const row of rows) {
    if (row.tmdbId == null) continue;
    const finished = row.completedPlays > 0 || row.maxCompletionPct >= FINISHED_AT;
    const prev = out.get(row.tmdbId);
    out.set(row.tmdbId, {
      tmdbId: row.tmdbId,
      finished: (prev?.finished ?? false) || finished,
      started: (prev?.started ?? false) || row.maxCompletionPct > 0,
      lastPlayedAt: Math.max(prev?.lastPlayedAt ?? 0, row.lastPlayedAt ?? 0),
    });
  }
  return out;
}

export type NextPart =
  | { part: TmdbCollectionPart; resume: boolean }
  /** The next part exists but the library doesn't have it. */
  | { missing: TmdbCollectionPart }
  /** Released parts all seen, or the series not started. */
  | null;

/**
 * The part to watch next: the first released part after the *furthest*
 * finished one. Someone who saw Alien and then Alien 3 is past Aliens, and
 * offering it would be offering a step back.
 *
 * A gap — the next part isn't in the library — offers nothing for the series
 * by default, rather than skipping ahead and recommending part four to
 * someone who hasn't seen part three. `skipMissing` is for the series padded
 * with direct-to-video entries a library leaves out on purpose.
 */
export function nextPart(
  parts: TmdbCollectionPart[],
  watched: ReadonlyMap<number, Pick<WatchedFilm, "finished" | "started">>,
  inLibrary: ReadonlySet<number>,
  today: number,
  opts: { skipMissing?: boolean } = {},
): NextPart {
  // Undated parts are announced, not released.
  const released = parts
    .filter((p) => p.releaseDate && Date.parse(p.releaseDate) <= today)
    .sort((a, b) => Date.parse(a.releaseDate!) - Date.parse(b.releaseDate!));
  let furthest = -1;
  released.forEach((p, i) => {
    if (watched.get(p.id)?.finished) furthest = i;
  });
  if (furthest < 0) return null;
  for (const part of released.slice(furthest + 1)) {
    if (!inLibrary.has(part.id)) {
      if (opts.skipMissing) continue;
      return { missing: part };
    }
    return { part, resume: watched.get(part.id)?.started ?? false };
  }
  return null;
}

/** "Next up: Alien 3, Toy Story 4 and 3 more." */
export function franchiseSummary(titles: string[]): string {
  const shown = titles.slice(0, 3);
  const rest = titles.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} and ${rest} more`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
        : (shown[0] ?? "");
  return `The next film in series you've started. Next up: ${list}.`;
}
