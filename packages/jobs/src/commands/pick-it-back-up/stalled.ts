/**
 * Which shows someone stopped partway through, and where they'd pick up.
 *
 * Read from `playback_sessions`, which files every episode play under its
 * show (`grandparentRatingKey`). Plex's own view state can't answer this for
 * anyone but the owner — it is per token, and Rube holds only the
 * owner's — which is the same reason the `tb.` smart-filter fields exist.
 *
 * "Where they'd pick up" is placed against the show's episode list from Plex,
 * not counted: the furthest episode they finished, then the one after. A count
 * of plays can't tell a show finished from one whose early plays have aged out
 * of playback retention, and it can't say which episode is next. Placing the
 * furthest one can, and needs only the recent end of the history, which is the
 * part retention keeps.
 */
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { playbackSessions, type Db } from "@rube/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A play this complete counts as watching the episode — the same line the
 * taste profile draws, and where Plex itself marks an episode watched (90%)
 * less the credits some people skip.
 */
export const FINISHED_AT = 0.8;

export interface EpisodePlay {
  /** Best completion across every play of the episode, 0–1. */
  completion: number;
  finished: boolean;
}

export interface StalledShow {
  showKey: string;
  /** Their latest play of any episode. */
  lastPlayedAt: number;
  plays: Map<string, EpisodePlay>;
}

/**
 * Shows someone last played between `maxStallDays` and `stallDays` ago, with
 * every episode play of theirs the log still holds.
 *
 * A play imported from Plex's history (`plex-history`) carries no completion,
 * and Plex only records a view once something was watched through, so it
 * counts as finished — as it does in the taste profile.
 */
export function stalledShows(
  db: Db,
  userIds: number[],
  now: number,
  opts: { stallDays: number; maxStallDays: number },
): StalledShow[] {
  if (userIds.length === 0) return [];
  const rows = db
    .select({
      showKey: sql<string>`${playbackSessions.grandparentRatingKey}`,
      episodeKey: playbackSessions.ratingKey,
      completion: sql<number>`max(${playbackSessions.completionPct})`,
      finished: sql<number>`max(case when ${playbackSessions.source} = 'plex-history' or ${playbackSessions.state} = 'completed' or ${playbackSessions.completionPct} >= ${FINISHED_AT} then 1 else 0 end)`,
      lastPlayedAt: sql<number>`max(${playbackSessions.startedAt})`,
    })
    .from(playbackSessions)
    .where(
      and(
        inArray(playbackSessions.userId, userIds),
        sql`${playbackSessions.type} = 'episode'`,
        isNotNull(playbackSessions.grandparentRatingKey),
      ),
    )
    .groupBy(playbackSessions.grandparentRatingKey, playbackSessions.ratingKey)
    .all();

  const byShow = new Map<string, StalledShow>();
  for (const r of rows) {
    const show = byShow.get(r.showKey) ?? { showKey: r.showKey, lastPlayedAt: 0, plays: new Map() };
    show.lastPlayedAt = Math.max(show.lastPlayedAt, r.lastPlayedAt);
    show.plays.set(r.episodeKey, { completion: r.completion, finished: r.finished === 1 });
    byShow.set(r.showKey, show);
  }

  const newest = now - opts.stallDays * DAY_MS;
  const oldest = now - opts.maxStallDays * DAY_MS;
  return [...byShow.values()]
    .filter((s) => s.lastPlayedAt <= newest && s.lastPlayedAt >= oldest)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export interface Leaf {
  ratingKey: string;
  season: number;
  episode: number;
}

export interface PickUpPoint {
  /** The episode to play next. */
  next: Leaf;
  /** It was started and not finished, rather than not started at all. */
  resume: boolean;
  /** Episodes from `next` to the end, `next` included. */
  remaining: number;
  /** Distinct episodes they finished that are still in the show. */
  finished: number;
}

/**
 * Where someone would pick a show back up, or null when there is nowhere to:
 * they are caught up, or none of their plays is an episode the show still has
 * (re-added under new keys), so there is no telling where they were.
 *
 * Specials are left out of the order: season 0 sits before season 1 in Plex's
 * numbering and would otherwise be "next" for everyone who finished a series.
 */
export function pickUpPoint(leaves: Leaf[], plays: Map<string, EpisodePlay>): PickUpPoint | null {
  const order = leaves.filter((l) => l.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode);
  let furthestPlayed = -1;
  let furthestFinished = -1;
  let finished = 0;
  order.forEach((leaf, i) => {
    const play = plays.get(leaf.ratingKey);
    if (!play) return;
    furthestPlayed = i;
    if (play.finished) {
      furthestFinished = i;
      finished++;
    }
  });
  if (furthestPlayed === -1) return null;
  // Stopped partway into the furthest episode they reached: that one, again.
  const resume = furthestPlayed > furthestFinished;
  const nextIndex = resume ? furthestPlayed : furthestFinished + 1;
  if (nextIndex >= order.length) return null;
  return { next: order[nextIndex], resume, remaining: order.length - nextIndex, finished };
}

export function episodeCode(leaf: Pick<Leaf, "season" | "episode">): string {
  return `S${leaf.season}E${leaf.episode}`;
}

/** The row's description: what it is, then the first few next episodes. */
export function pickUpSummary(picks: Array<{ title: string; point: PickUpPoint }>): string {
  const shown = picks.slice(0, 3).map((p) => `${p.title} ${episodeCode(p.point.next)}`);
  const rest = picks.length - shown.length;
  const parts = rest > 0 ? [...shown, `${rest} more`] : shown;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join("");
  return `Shows you started and haven't been back to. Next up: ${list}.`;
}
