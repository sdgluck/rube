/**
 * A person's taste, read from what Tinkerbell has seen them watch.
 *
 * The arithmetic happens here rather than in the prompt on purpose. Handing a
 * model three hundred raw plays and asking it to "work out their taste" is a
 * large, expensive prompt whose answer changes with the order of the list;
 * weighting and aggregating locally gives a short, deterministic summary — the
 * genres, eras and titles that actually dominate — and leaves the model the
 * part it is good at, reading the themes those titles share.
 *
 * History comes from `playback_sessions`, not Plex's `/status/sessions/history`.
 * Only the local log knows how far someone got: a film switched off at ten
 * minutes is evidence *against* a taste, and Plex's history records it the
 * same as one watched twice.
 */
import { and, gte, inArray, sql } from "drizzle-orm";
import { mediaItems, playbackSessions, watchState, type Db } from "@tinkerbell/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A finished-enough play. Below this, but above `ABANDONED_BELOW`, someone stopped partway. */
const FINISHED_AT = 0.8;
/** Stopped this early, the title most likely wasn't for them. */
const ABANDONED_BELOW = 0.2;
/**
 * A low-completion play this recent is probably still being watched — a film
 * paused overnight, a series two episodes in — not an abandonment.
 */
const IN_PROGRESS_GRACE_MS = 3 * DAY_MS;
/** A title watched four months ago counts half as much as one watched today. */
const RECENCY_HALF_LIFE_DAYS = 120;
/**
 * Plays are capped before weighting. A series is dozens of plays, a film one;
 * uncapped, one long binge outweighs a year of films and the profile describes
 * a single show.
 */
const PLAYS_CAP = 10;

const TOP_GENRES = 10;
const TOP_DECADES = 5;
const TOP_CONTENT_RATINGS = 5;
const TOP_FAVOURITES = 40;
const TOP_ABANDONED = 10;

/** One title in someone's history: a film, or a show its episodes roll up to. */
export interface WatchedTitle {
  /** The film's rating key, or the show's for an episode. */
  key: string;
  title: string;
  year: number | null;
  /** `movie` | `show`, from the library index; null when the index doesn't have it. */
  type: string | null;
  genres: string[] | null;
  rating: number | null;
  contentRating: string | null;
  plays: number;
  maxCompletion: number;
  lastPlayedAt: number;
  /**
   * Whether any play was observed live by the poller. Rows imported from Plex's
   * history carry no completion — and Plex only records a view once something
   * was watched through — so an imported-only title is treated as finished,
   * never as abandoned.
   */
  observed: boolean;
}

export interface TasteProfile {
  titleCount: number;
  /** Share of positive weight that is films rather than series, 0–1. */
  movieShare: number;
  genres: Array<{ name: string; share: number }>;
  decades: Array<{ decade: number; share: number }>;
  contentRatings: Array<{ name: string; share: number }>;
  /** Weighted mean of the 0–10 rating of what they watch, when enough of it is rated. */
  meanRating: number | null;
  /** Strongest first, as `Title (Year)`. */
  favourites: string[];
  abandoned: string[];
}

/**
 * The account ids someone's plays are filed under. A shared user's plays carry
 * their plex.tv id, which is `plex_users.userId`; the owner's carry the
 * server-local account `1` — the same split BYW's `matchKnownUsers` handles —
 * so the owner is looked up under both.
 */
export function historyUserIds(user: { userId: number; isOwner: boolean }): number[] {
  return user.isOwner && user.userId !== 1 ? [user.userId, 1] : [user.userId];
}

/** Everything someone watched since `since`, rolled up to films and shows, with the index's metadata. */
export function watchedTitles(db: Db, userIds: number[], since: number): WatchedTitle[] {
  if (userIds.length === 0) return [];
  const key = sql<string>`coalesce(${playbackSessions.grandparentRatingKey}, ${playbackSessions.ratingKey})`;
  const plays = db
    .select({
      key,
      title: sql<string>`max(coalesce(${playbackSessions.grandparentTitle}, ${playbackSessions.title}))`,
      plays: sql<number>`count(*)`,
      maxCompletion: sql<number>`max(${playbackSessions.completionPct})`,
      lastPlayedAt: sql<number>`max(${playbackSessions.startedAt})`,
      observed: sql<number>`max(case when ${playbackSessions.source} = 'poller' then 1 else 0 end)`,
    })
    .from(playbackSessions)
    .where(
      and(
        inArray(playbackSessions.userId, userIds),
        gte(playbackSessions.startedAt, since),
        inArray(playbackSessions.type, ["movie", "episode"]),
      ),
    )
    .groupBy(key)
    .all();

  const meta = new Map<string, typeof mediaItems.$inferSelect>();
  const keys = plays.map((p) => p.key);
  // Chunked to stay well inside SQLite's bound-parameter limit on a long history.
  for (let i = 0; i < keys.length; i += 500) {
    for (const row of db
      .select()
      .from(mediaItems)
      .where(inArray(mediaItems.ratingKey, keys.slice(i, i + 500)))
      .all()) {
      meta.set(row.ratingKey, row);
    }
  }

  return plays.map((p) => {
    const m = meta.get(p.key);
    return {
      key: p.key,
      title: m?.title ?? p.title,
      year: m?.year ?? null,
      type: m?.type ?? null,
      genres: m?.genres ?? null,
      rating: m?.rating ?? null,
      contentRating: m?.contentRating ?? null,
      plays: p.plays,
      maxCompletion: p.maxCompletion ?? 0,
      lastPlayedAt: p.lastPlayedAt,
      observed: p.observed === 1,
    };
  });
}

/**
 * Every film and show someone has ever played, for keeping them out of their
 * own recommendations. All-time on purpose: the profile reads a window, but a
 * film watched two years ago is no discovery. `watch_state` is never pruned,
 * so it remembers films the session log has aged out; shows come from the
 * session log, because `watch_state` holds episodes.
 */
export function everWatchedKeys(db: Db, userIds: number[]): Set<string> {
  const keys = new Set<string>();
  if (userIds.length === 0) return keys;
  for (const row of db
    .selectDistinct({
      key: sql<string>`coalesce(${playbackSessions.grandparentRatingKey}, ${playbackSessions.ratingKey})`,
    })
    .from(playbackSessions)
    .where(inArray(playbackSessions.userId, userIds))
    .all()) {
    keys.add(row.key);
  }
  for (const row of db
    .select({ key: watchState.ratingKey })
    .from(watchState)
    .where(inArray(watchState.userId, userIds))
    .all()) {
    keys.add(row.key);
  }
  return keys;
}

/** How much one title says about someone's taste. Negative for one they gave up on. */
export function titleWeight(t: WatchedTitle, now: number): number {
  const ageDays = Math.max(0, now - t.lastPlayedAt) / DAY_MS;
  const recency = 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
  const plays = Math.log2(1 + Math.min(t.plays, PLAYS_CAP));
  return plays * completionFactor(t, now) * recency;
}

function completionFactor(t: WatchedTitle, now: number): number {
  if (!t.observed || t.maxCompletion >= FINISHED_AT) return 1;
  if (now - t.lastPlayedAt < IN_PROGRESS_GRACE_MS) return 0.3;
  return t.maxCompletion < ABANDONED_BELOW ? -0.5 : 0.3;
}

export function isAbandoned(t: WatchedTitle, now: number): boolean {
  return completionFactor(t, now) < 0;
}

function label(t: Pick<WatchedTitle, "title" | "year">): string {
  return `${t.title}${t.year ? ` (${t.year})` : ""}`;
}

/** Scores to shares of their positive total, strongest first. */
function shares<K>(scores: Map<K, number>, top: number): Array<{ key: K; share: number }> {
  const positive = [...scores].filter(([, v]) => v > 0);
  const total = positive.reduce((sum, [, v]) => sum + v, 0);
  if (total <= 0) return [];
  return positive
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([key, v]) => ({ key, share: v / total }));
}

export function buildTasteProfile(titles: WatchedTitle[], now: number): TasteProfile {
  const genres = new Map<string, number>();
  const decades = new Map<number, number>();
  const certs = new Map<string, number>();
  let movieWeight = 0;
  let positiveWeight = 0;
  let ratingSum = 0;
  let ratingWeight = 0;

  const weighted = titles.map((t) => ({ t, w: titleWeight(t, now) }));
  for (const { t, w } of weighted) {
    // An abandoned title counts against its genres, so "started three horror
    // films and finished none" pulls horror down rather than up.
    for (const g of t.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + w);
    if (w <= 0) continue;
    positiveWeight += w;
    if (t.type === "movie") movieWeight += w;
    if (t.year) {
      const decade = Math.floor(t.year / 10) * 10;
      decades.set(decade, (decades.get(decade) ?? 0) + w);
    }
    if (t.contentRating) certs.set(t.contentRating, (certs.get(t.contentRating) ?? 0) + w);
    if (t.rating != null) {
      ratingSum += t.rating * w;
      ratingWeight += w;
    }
  }

  return {
    titleCount: titles.length,
    movieShare: positiveWeight > 0 ? movieWeight / positiveWeight : 0,
    genres: shares(genres, TOP_GENRES).map(({ key, share }) => ({ name: key, share })),
    decades: shares(decades, TOP_DECADES).map(({ key, share }) => ({ decade: key, share })),
    contentRatings: shares(certs, TOP_CONTENT_RATINGS).map(({ key, share }) => ({ name: key, share })),
    // Under a third of the weight rated, and the mean describes the few
    // matched titles rather than the person.
    meanRating: ratingWeight > 0 && ratingWeight >= positiveWeight / 3 ? ratingSum / ratingWeight : null,
    favourites: weighted
      .filter(({ w }) => w > 0)
      .sort((a, b) => b.w - a.w)
      .slice(0, TOP_FAVOURITES)
      .map(({ t }) => label(t)),
    abandoned: weighted
      .filter(({ t }) => isAbandoned(t, now))
      .sort((a, b) => b.t.lastPlayedAt - a.t.lastPlayedAt)
      .slice(0, TOP_ABANDONED)
      .map(({ t }) => label(t)),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The profile as the prompt carries it. Fenced, because titles and genres are
 * editable in Plex and must read as data: a closing tag inside one is defused
 * rather than allowed to end the fence and have what follows read as
 * instructions.
 */
export function tasteProfilePromptBlock(profile: TasteProfile): string {
  const lines = [
    `Titles watched: ${profile.titleCount} (${pct(profile.movieShare)} films, ${pct(1 - profile.movieShare)} series)`,
  ];
  if (profile.genres.length > 0) {
    lines.push(
      `Genres, by how much they watch them: ${profile.genres.map((g) => `${g.name} ${pct(g.share)}`).join(", ")}`,
    );
  }
  if (profile.decades.length > 0) {
    lines.push(`Eras: ${profile.decades.map((d) => `${d.decade}s ${pct(d.share)}`).join(", ")}`);
  }
  if (profile.contentRatings.length > 0) {
    lines.push(`Content ratings: ${profile.contentRatings.map((c) => `${c.name} ${pct(c.share)}`).join(", ")}`);
  }
  if (profile.meanRating != null) {
    lines.push(`Typical critic/audience rating of what they watch: ${profile.meanRating.toFixed(1)}/10`);
  }
  lines.push("", "What they watch most and finish (strongest first):", ...profile.favourites.map((t) => `- ${t}`));
  if (profile.abandoned.length > 0) {
    lines.push("", "Started but gave up on early:", ...profile.abandoned.map((t) => `- ${t}`));
  }
  const fenced = lines.join("\n").replace(/<\/?history>/gi, (m) => m.replace(">", "_>"));
  return `<history>\n${fenced}\n</history>`;
}
