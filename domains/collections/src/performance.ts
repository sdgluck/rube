/**
 * Whether anyone watches what a collection holds.
 *
 * Plex does not record where a play was started from, so "plays from this
 * collection" is unknowable. What this answers instead is "plays of this
 * collection's titles since they joined it": a play only counts once the
 * title was a member. Without that cut-off, a rule that collects last year's
 * most-watched films would score itself on the plays that put them there, and
 * look like the best collection on the server while nobody opens it.
 *
 * When a title joined comes from `rule_run_changes`. A collection no rule has
 * diffed (hand-made, or older than the change log) has no join time, so its
 * plays count from the start of the window — the honest reading of "we don't
 * know", and the window bounds how wrong it can be.
 *
 * Episodes count towards their show (`grandparent_rating_key`), because a TV
 * collection's members are shows and nobody plays a show.
 *
 * The session log is pruned under `playback_retention_days`, so the window is
 * also capped by how much history exists; `coveredDays` says which applied, and
 * the UI prints that rather than a period it can't back up.
 */

import { sql } from "drizzle-orm";
import { playbackSessions, type Db } from "@tinkerbell/db";
import { perDeps } from "@tinkerbell/container";

export const PERFORMANCE_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export interface CollectionPerformance {
  /** Members in the local mirror. */
  members: number;
  /** Members played at least once since they joined (within the window). */
  playedMembers: number;
  plays: number;
  /** Distinct known users; plays Plex attributed to nobody don't count as one. */
  viewers: number;
  lastPlayedAt: number | null;
}

export interface PerformanceWindow {
  since: number;
  /** Days of history behind the figures: the window, or less if the log is younger. */
  coveredDays: number;
}

export interface PerformanceDeps {
  db: Db;
}
export const createPerformance = perDeps(function createPerformance(deps: PerformanceDeps) {
  const { db } = deps;

  function performanceWindow(now: number = Date.now()): PerformanceWindow {
    const since = now - PERFORMANCE_WINDOW_DAYS * DAY_MS;
    const earliest = db
      .select({ at: sql<number | null>`min(${playbackSessions.startedAt})` })
      .from(playbackSessions)
      .get()?.at;
    const from = earliest == null ? now : Math.max(since, earliest);
    return { since, coveredDays: Math.max(0, Math.floor((now - from) / DAY_MS)) };
  }

  /**
   * Figures for the given collections, or every collection when `keys` is
   * omitted. A collection with no members in the mirror is absent.
   */
  function getCollectionPerformance(
    keys?: readonly string[],
    now: number = Date.now(),
  ): Map<string, CollectionPerformance> {
    if (keys && keys.length === 0) return new Map();
    const { since } = performanceWindow(now);
    const scope = keys
      ? sql`where ci.collection_rating_key in (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`
      : sql``;

    // One grouped pass. Plays are narrowed to the window before the join so the
    // `started_at` index does the work, and the join is on a plain key —
    // an `OR` across rating key and grandparent key would scan both sides.
    const rows = db.all<{
      key: string;
      members: number;
      played_members: number;
      plays: number;
      viewers: number;
      last_played_at: number | null;
    }>(sql`
      with plays as (
        select coalesce(grandparent_rating_key, rating_key) as k, user_id, started_at
        from playback_sessions
        where started_at >= ${since}
      ),
      joined as (
        select collection_rating_key as ck, item_rating_key as ik, max(at) as at
        from rule_run_changes
        where change = 'added' and collection_rating_key is not null
        group by collection_rating_key, item_rating_key
      )
      select
        ci.collection_rating_key as key,
        count(distinct ci.item_rating_key) as members,
        count(distinct case when p.k is not null then ci.item_rating_key end) as played_members,
        count(p.k) as plays,
        count(distinct nullif(p.user_id, 0)) as viewers,
        max(p.started_at) as last_played_at
      from collection_items ci
      left join joined j on j.ck = ci.collection_rating_key and j.ik = ci.item_rating_key
      left join plays p on p.k = ci.item_rating_key and p.started_at >= coalesce(j.at, 0)
      ${scope}
      group by ci.collection_rating_key
    `);

    return new Map(
      rows.map((r) => [
        r.key,
        {
          members: r.members,
          playedMembers: r.played_members,
          plays: r.plays,
          viewers: r.viewers,
          lastPlayedAt: r.last_played_at,
        },
      ]),
    );
  }

  return { getCollectionPerformance, performanceWindow };
});
