/**
 * Whose request is whose, when it arrived, and whether they've got to it yet.
 * Apart from the command so each decision is testable without Overseerr.
 */
import { playbackSessions, watchState, type Db } from "@rube/db";
import { SEERR_AVAILABLE, SEERR_PARTIALLY_AVAILABLE, type SeerrRequest } from "@rube/seerr";
import { and, gte, inArray } from "drizzle-orm";

/** Watched this far through counts as seen — the line the other personal rows draw. */
const FINISHED_AT = 0.8;

export interface KnownUser {
  userId: number;
  username: string;
  email: string | null;
}

/**
 * The Plex user who asked: by plex.tv id first, which can't be ambiguous, then
 * by name, then by email. Overseerr accounts made by signing in with Plex
 * carry `plexId`; local Overseerr accounts only have a name or an email.
 */
export function createRequesterMatcher(users: KnownUser[]): (by: SeerrRequest["requestedBy"]) => KnownUser | undefined {
  const byId = new Map(users.map((u) => [u.userId, u]));
  const byName = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));
  return (by) => {
    if (by.plexId != null && byId.has(by.plexId)) return byId.get(by.plexId);
    for (const name of [by.plexUsername, by.username]) {
      const hit = name ? byName.get(name.toLowerCase()) : undefined;
      if (hit) return hit;
    }
    return by.email ? byEmail.get(by.email.toLowerCase()) : undefined;
  };
}

/** Something to show for the request: arrived, and in Plex under a key. */
export function isArrived(req: SeerrRequest): req is SeerrRequest & { media: { ratingKey: string } } {
  return (
    (req.media.status === SEERR_AVAILABLE || req.media.status === SEERR_PARTIALLY_AVAILABLE) &&
    typeof req.media.ratingKey === "string" &&
    req.media.ratingKey.length > 0
  );
}

/** When it arrived, falling back to when it was asked for. */
export function arrivedAt(req: SeerrRequest): number {
  const added = req.media.mediaAddedAt ? Date.parse(req.media.mediaAddedAt) : NaN;
  return Number.isFinite(added) ? added : Date.parse(req.createdAt);
}

/**
 * Of these arrivals, the ones the person has got to.
 *
 * A film counts once it's watched through; a show once they've played any of
 * it since it arrived — they've found it, which is all this row is for, and a
 * series takes months to finish.
 */
export function gotTo(
  db: Db,
  userIds: number[],
  arrivals: Array<{ ratingKey: string; type: string; arrivedAt: number }>,
): Set<string> {
  const out = new Set<string>();
  if (userIds.length === 0 || arrivals.length === 0) return out;
  const films = arrivals.filter((a) => a.type === "movie").map((a) => a.ratingKey);
  if (films.length > 0) {
    for (const row of db
      .select({
        ratingKey: watchState.ratingKey,
        completed: watchState.completedPlays,
        pct: watchState.maxCompletionPct,
      })
      .from(watchState)
      .where(and(inArray(watchState.userId, userIds), inArray(watchState.ratingKey, films)))
      .all()) {
      if (row.completed > 0 || row.pct >= FINISHED_AT) out.add(row.ratingKey);
    }
  }
  const shows = arrivals.filter((a) => a.type === "show");
  if (shows.length > 0) {
    const since = new Map(shows.map((s) => [s.ratingKey, s.arrivedAt]));
    for (const row of db
      .select({ show: playbackSessions.grandparentRatingKey, startedAt: playbackSessions.startedAt })
      .from(playbackSessions)
      .where(
        and(
          inArray(playbackSessions.userId, userIds),
          inArray(playbackSessions.grandparentRatingKey, [...since.keys()]),
          gte(playbackSessions.startedAt, Math.min(...since.values())),
        ),
      )
      .all()) {
      if (row.show && row.startedAt >= since.get(row.show)!) out.add(row.show);
    }
  }
  return out;
}

/** "You asked for these, and they're here: Dune: Part Two, The Bear and 2 more." */
export function requestsSummary(titles: string[]): string {
  const shown = titles.slice(0, 3);
  const rest = titles.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} and ${rest} more`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
        : (shown[0] ?? "");
  return `You asked for these, and they're here: ${list}.`;
}
