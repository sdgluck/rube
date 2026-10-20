/**
 * Which films someone loved long enough ago to be worth offering again.
 * Apart from the command so the rules — finished, not lately, rewatched most
 * first — are testable without Plex.
 */
import { mediaItems, watchState, type Db } from "@tinkerbell/db";
import { and, eq, inArray } from "drizzle-orm";

/** Watched this far through counts as seen — the line the other personal rows draw. */
const FINISHED_AT = 0.8;

export interface PastFavourite {
  /** One film, however many copies: its TMDb id, or the rating key when it has none. */
  identity: string;
  title: string;
  completedPlays: number;
  lastPlayedAt: number;
  rating: number | null;
  /** Where it is, one copy per library. */
  copies: Array<{ sectionId: string; ratingKey: string }>;
}

/**
 * Films these accounts finished, by film rather than by copy: a 4K and a
 * 1080p of one film are one entry, and its last play is the latest on either
 * — so a rewatch of the 4K last week keeps the 1080p out too.
 */
export function finishedFilms(db: Db, userIds: number[], sectionIds: string[]): PastFavourite[] {
  if (userIds.length === 0 || sectionIds.length === 0) return [];
  const rows = db
    .select({
      ratingKey: watchState.ratingKey,
      completedPlays: watchState.completedPlays,
      maxCompletionPct: watchState.maxCompletionPct,
      lastPlayedAt: watchState.lastPlayedAt,
      tmdbId: mediaItems.tmdbId,
      sectionId: mediaItems.sectionId,
      title: mediaItems.title,
      rating: mediaItems.rating,
    })
    .from(watchState)
    .innerJoin(mediaItems, eq(mediaItems.ratingKey, watchState.ratingKey))
    .where(
      and(inArray(watchState.userId, userIds), eq(mediaItems.type, "movie"), inArray(mediaItems.sectionId, sectionIds)),
    )
    .all();
  const films = new Map<string, PastFavourite & { finished: boolean }>();
  for (const row of rows) {
    const identity = row.tmdbId != null ? `tmdb:${row.tmdbId}` : `key:${row.ratingKey}`;
    const film = films.get(identity) ?? {
      identity,
      title: row.title,
      completedPlays: 0,
      lastPlayedAt: 0,
      rating: row.rating,
      copies: [],
      finished: false,
    };
    film.completedPlays += row.completedPlays;
    film.lastPlayedAt = Math.max(film.lastPlayedAt, row.lastPlayedAt ?? 0);
    film.finished ||= row.completedPlays > 0 || row.maxCompletionPct >= FINISHED_AT;
    film.rating = film.rating ?? row.rating;
    if (!film.copies.some((c) => c.sectionId === row.sectionId))
      film.copies.push({ sectionId: row.sectionId, ratingKey: row.ratingKey });
    films.set(identity, film);
  }
  return [...films.values()].filter((f) => f.finished).map(({ finished: _, ...film }) => film);
}

/**
 * The ones to offer, best first: finished, and not played at all since
 * `before`. Rewatched most leads — a film someone has seen three times is a
 * favourite, not a film they happened to see — then the better rated, then
 * the one they've gone longest without.
 */
export function pastFavourites(films: PastFavourite[], before: number): PastFavourite[] {
  return films
    .filter((f) => f.lastPlayedAt > 0 && f.lastPlayedAt <= before)
    .sort(
      (a, b) =>
        b.completedPlays - a.completedPlays ||
        (b.rating ?? -1) - (a.rating ?? -1) ||
        a.lastPlayedAt - b.lastPlayedAt ||
        a.title.localeCompare(b.title),
    );
}

/** "Films you loved a while back: Heat, Alien and 6 more." */
export function watchAgainSummary(titles: string[]): string {
  const shown = titles.slice(0, 3);
  const rest = titles.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} and ${rest} more`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
        : (shown[0] ?? "");
  return `Films you loved a while back: ${list}.`;
}
