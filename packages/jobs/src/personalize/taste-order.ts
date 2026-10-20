/**
 * Ordering a pool of titles by one person's taste — for the rows whose
 * contents are decided by something else (a holiday, what arrived this month)
 * and whose order is the only personal part.
 *
 * Three tiers, so a row is never left unordered: the built-in recommender
 * when it is on and has their history; else how much of their genre taste
 * each title shares; else the pool's own order. Season Collections had this
 * inline; New For You needed the same thing, and two copies would drift the
 * day one learned a better fallback.
 */
import type { Services } from "@tinkerbell/composition";
import { DAY_MS } from "@tinkerbell/core";
import type { Db } from "@tinkerbell/db";
import {
  buildTasteProfile,
  historyUserIds,
  titleWeight,
  watchedTitles,
} from "../commands/we-think-youd-like/profile.ts";

/** How far back a person's taste is read. */
const HISTORY_DAYS = 365;

/**
 * Order `pool` by how much of a person's genre taste each title shares. A
 * title scores the sum of the person's shares of its genres; ties keep
 * `pool`'s order.
 */
export function rankByGenreShare(
  pool: string[],
  genresByKey: ReadonlyMap<string, string[]>,
  shares: ReadonlyArray<{ name: string; share: number }>,
): string[] {
  const share = new Map(shares.map((g) => [g.name.toLowerCase(), g.share]));
  const score = (key: string) =>
    (genresByKey.get(key) ?? []).reduce((n, g) => n + (share.get(g.toLowerCase()) ?? 0), 0);
  return pool
    .map((key, i) => ({ key, i, s: score(key) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.key);
}

export function createTasteOrder(deps: { db: Db; recommendations: Services["recommendations"]; now: () => number }) {
  const { db, recommendations, now } = deps;
  const status = recommendations.status();
  const ranked = status.enabled && status.available;
  // Each person's history once, however many libraries and pools.
  const tastes = new Map<
    string,
    { history: Array<{ ratingKey: string; weight: number }>; genres: Array<{ name: string; share: number }> }
  >();

  function tasteOf(user: { username: string; userId: number; isOwner: boolean }) {
    let taste = tastes.get(user.username);
    if (!taste) {
      const titles = watchedTitles(db, historyUserIds(user), now() - HISTORY_DAYS * DAY_MS);
      taste = {
        history: titles.map((t) => ({ ratingKey: t.key, weight: titleWeight(t, now()) })),
        genres: titles.length > 0 ? buildTasteProfile(titles, now()).genres : [],
      };
      tastes.set(user.username, taste);
    }
    return taste;
  }

  /** `pool` in this person's order. */
  function order(
    user: { username: string; userId: number; isOwner: boolean },
    pool: string[],
    genresByKey: ReadonlyMap<string, string[]>,
  ): string[] {
    const taste = tasteOf(user);
    if (ranked && taste.history.length > 0) {
      const ranking = recommendations.shortlist({ history: taste.history, candidates: pool, limit: pool.length });
      // The recommender leaves out titles it has no vector for; they go after
      // the ones it could rank rather than out of the row.
      if ("ratingKeys" in ranking) return [...new Set([...ranking.ratingKeys, ...pool])];
    }
    return taste.genres.length > 0 ? rankByGenreShare(pool, genresByKey, taste.genres) : pool;
  }

  return {
    order,
    hasHistory: (user: { username: string; userId: number; isOwner: boolean }) => tasteOf(user).history.length > 0,
  };
}
