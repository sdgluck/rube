/**
 * Building a digest: what happened on this server, over a period, optionally
 * seen through one user's tastes.
 *
 * **Pure and DB-only.** No Plex calls, no network, no clock beyond what the
 * caller passes in. That is what makes a digest for last week reproducible
 * three weeks later — which is the only way to answer "what did it actually
 * send me" without having kept a copy of the message.
 *
 * The two halves are deliberately different questions. The server-wide digest
 * is *reporting*: here is everything that arrived and everything that was
 * watched. A per-user digest is *recommending*: here are five things you
 * specifically might want, drawn from the same period. A user digest that
 * listed 200 additions would be a worse version of the server one.
 */
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db, collections, mediaItems, playbackSessions, watchState } from "@tinkerbell/db";
import { queuedCandidates } from "@tinkerbell/domain.cleanup";
import type { UserPreferences } from "@tinkerbell/core";

export interface DigestInput {
  /** Inclusive lower bound, epoch ms. */
  since: number;
  /** Exclusive upper bound, epoch ms. */
  until: number;
  /** Absent = the server-wide digest. */
  userId?: number;
  /** The user's tastes. Only read when `userId` is set. */
  preferences?: UserPreferences;
  /** Cap on the tailored `added` list. Ignored for the server-wide digest. */
  userItemCap?: number;
}

export interface DigestItem {
  ratingKey: string;
  /** What to show. For an episode this is the show's name, not the episode's. */
  title: string;
  year: number | null;
  type: string;
  sectionTitle: string;
  /** Populated on `added`. Epoch ms (converted from Plex's seconds). */
  addedAt?: number;
  /** Populated on `watched` and `topTitles`. */
  plays?: number;
  watchedMs?: number;
  /** Populated on `leavingSoon`: runs left before the item is actioned. */
  runsRemaining?: number;
  /**
   * A publicly reachable poster, when one exists.
   *
   * Always undefined today, and the field is here so that stays a data problem
   * rather than a rendering one — see the note in `render.ts`. Nothing in the
   * renderers may assume it is set.
   */
  imageUrl?: string;
}

export interface Digest {
  period: { since: number; until: number };
  /** Scoped when the digest is a user's; the server-wide one has no `userId`. */
  userId?: number;
  added: DigestItem[];
  watched: DigestItem[];
  topTitles: DigestItem[];
  newCollections: string[];
  leavingSoon: DigestItem[];
  stats: { itemsAdded: number; hoursWatched: number; activeUsers: number };
}

/** How many items a per-user digest lists before it becomes a wall of text. */
export const DEFAULT_USER_ITEM_CAP = 5;

/** How many rows the server-wide lists carry. */
const SERVER_LIST_LIMIT = 25;
const TOP_TITLES_LIMIT = 10;
const LEAVING_SOON_LIMIT = 10;

/**
 * `media_items.addedAt` is Plex's, in seconds; every other timestamp in the
 * system is milliseconds. Both boundaries are converted with the same
 * `Math.floor`, so an item added exactly on a boundary lands on exactly one
 * side of it — inclusive at `since`, exclusive at `until`.
 */
function toPlexSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Only the modes that actually remove something count as "leaving". */
const REMOVING_MODES = new Set(["unmonitor", "delete"]);

export function buildDigest(input: DigestInput): Digest {
  const { since, until, userId } = input;

  const added = addedInPeriod(since, until);
  const watched = watchedInPeriod(since, until, userId);
  const topTitles = topPlayedInPeriod(since, until, userId);
  const newCollections = collectionsInPeriod(since, until);
  const leaving = leavingSoon();
  const stats = periodStats(since, until, added.length);

  if (userId == null) {
    return {
      period: { since, until },
      added: added.slice(0, SERVER_LIST_LIMIT),
      watched: watched.slice(0, SERVER_LIST_LIMIT),
      topTitles,
      newCollections,
      leavingSoon: leaving,
      stats,
    };
  }

  const cap = input.userItemCap ?? DEFAULT_USER_ITEM_CAP;
  const preferences = input.preferences;

  return {
    period: { since, until },
    userId,
    added: preferences ? tailor(added, preferences, userId, cap) : added.slice(0, cap),
    // Their own watching, not the server's — "what you watched this week".
    watched: watched.slice(0, cap),
    topTitles: topTitles.slice(0, cap),
    newCollections,
    // What's leaving is a property of the server, and it is the item most
    // worth telling a *user* about: it's the one thing on the list they can
    // still do something about.
    leavingSoon: leaving,
    stats,
  };
}

// ─── Sources ─────────────────────────────────────────────────────────────────

function addedInPeriod(since: number, until: number): DigestItem[] {
  const rows = db
    .select()
    .from(mediaItems)
    .where(
      and(
        gte(mediaItems.addedAt, toPlexSeconds(since)),
        lt(mediaItems.addedAt, toPlexSeconds(until)),
        // Episodes are excluded from "what's new": a season drop is 10 rows
        // that all mean one thing, and the show they belong to is the thing
        // anyone would want listed.
        ne(mediaItems.type, "episode"),
      ),
    )
    .orderBy(desc(mediaItems.addedAt))
    .all();

  return rows.map((row) => ({
    ratingKey: row.ratingKey,
    title: row.title,
    year: row.year,
    type: row.type,
    sectionTitle: row.sectionTitle,
    addedAt: (row.addedAt ?? 0) * 1000,
  }));
}

/**
 * Distinct items played in the period, most-watched first.
 *
 * Grouped by item rather than listing sessions: three sittings with one film
 * is one thing you watched, and the digest is a summary.
 */
function watchedInPeriod(since: number, until: number, userId?: number): DigestItem[] {
  const filters = [gte(playbackSessions.startedAt, since), lt(playbackSessions.startedAt, until)];
  if (userId != null) filters.push(eq(playbackSessions.userId, userId));

  const rows = db
    .select({
      ratingKey: playbackSessions.ratingKey,
      title: sql<string>`max(coalesce(nullif(${playbackSessions.grandparentTitle}, ''), ${playbackSessions.title}))`,
      type: sql<string>`max(${playbackSessions.type})`,
      sectionId: sql<string>`max(${playbackSessions.sectionId})`,
      plays: sql<number>`count(*)`,
      watchedMs: sql<number>`coalesce(sum(${playbackSessions.watchedMs}), 0)`,
    })
    .from(playbackSessions)
    .where(and(...filters))
    // For episodes this collapses to the show, so a binged season is one row.
    .groupBy(sql`coalesce(nullif(${playbackSessions.grandparentTitle}, ''), ${playbackSessions.title})`)
    .orderBy(desc(sql`sum(${playbackSessions.watchedMs})`))
    .all();

  return rows.map((row) => ({
    ratingKey: row.ratingKey,
    title: row.title,
    year: null,
    type: row.type,
    sectionTitle: "",
    plays: row.plays,
    watchedMs: row.watchedMs,
  }));
}

/** Most-played in the period, by play count rather than time. */
function topPlayedInPeriod(since: number, until: number, userId?: number): DigestItem[] {
  const filters = [gte(playbackSessions.startedAt, since), lt(playbackSessions.startedAt, until)];
  if (userId != null) filters.push(eq(playbackSessions.userId, userId));

  const rows = db
    .select({
      ratingKey: playbackSessions.ratingKey,
      title: sql<string>`max(coalesce(nullif(${playbackSessions.grandparentTitle}, ''), ${playbackSessions.title}))`,
      type: sql<string>`max(${playbackSessions.type})`,
      plays: sql<number>`count(*)`,
      watchedMs: sql<number>`coalesce(sum(${playbackSessions.watchedMs}), 0)`,
    })
    .from(playbackSessions)
    .where(and(...filters))
    .groupBy(sql`coalesce(nullif(${playbackSessions.grandparentTitle}, ''), ${playbackSessions.title})`)
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_TITLES_LIMIT)
    .all();

  return rows.map((row) => ({
    ratingKey: row.ratingKey,
    title: row.title,
    year: null,
    type: row.type,
    sectionTitle: "",
    plays: row.plays,
    watchedMs: row.watchedMs,
  }));
}

function collectionsInPeriod(since: number, until: number): string[] {
  // `collections.addedAt` is Plex's too, and in seconds for the same reason.
  const rows = db
    .select({ title: collections.title })
    .from(collections)
    .where(and(gte(collections.addedAt, toPlexSeconds(since)), lt(collections.addedAt, toPlexSeconds(until))))
    .orderBy(desc(collections.addedAt))
    .all();

  // A rule run recreates its collections nightly, so the same name can appear
  // in more than one section. One mention each is what a reader wants.
  return [...new Set(rows.map((r) => r.title))];
}

/**
 * Items a cleanup rule is about to remove.
 *
 * Not period-scoped: "leaving soon" is a statement about the future, and the
 * whole reason it belongs in a digest is that there is still time to act. Held
 * items are excluded — someone has already rescued those.
 */
function leavingSoon(): DigestItem[] {
  return queuedCandidates({ limit: 200 })
    .filter((c) => !c.held && REMOVING_MODES.has(c.mode) && c.runsRemaining <= 1)
    .slice(0, LEAVING_SOON_LIMIT)
    .map((c) => ({
      ratingKey: c.ratingKey,
      title: c.title,
      year: null,
      type: "",
      sectionTitle: "",
      runsRemaining: c.runsRemaining,
    }));
}

function periodStats(since: number, until: number, itemsAdded: number): Digest["stats"] {
  const row = db
    .select({
      watchedMs: sql<number>`coalesce(sum(${playbackSessions.watchedMs}), 0)`,
      activeUsers: sql<number>`count(distinct ${playbackSessions.userId})`,
    })
    .from(playbackSessions)
    .where(and(gte(playbackSessions.startedAt, since), lt(playbackSessions.startedAt, until)))
    .get();

  return {
    itemsAdded,
    // One decimal: "3.5 hours" reads; "3.4972222 hours" does not.
    hoursWatched: Math.round(((row?.watchedMs ?? 0) / 3_600_000) * 10) / 10,
    activeUsers: row?.activeUsers ?? 0,
  };
}

// ─── Per-user tailoring ──────────────────────────────────────────────────────

/**
 * Narrow this period's additions to the handful one user might actually want.
 *
 * Excludes are hard and ranking is soft. Something a user said they hate is
 * dropped; something they said they love is moved up. That asymmetry matters:
 * a digest that silently dropped everything outside a loved genre would be
 * empty most weeks, and an empty digest is one nobody opens again.
 *
 * Unknown metadata never excludes. An item Plex hasn't matched has no genres
 * and no rating, and treating that as "fails your rating floor" would quietly
 * hide exactly the new arrivals that haven't been scanned yet.
 */
export function tailor(items: DigestItem[], prefs: UserPreferences, userId: number, cap: number): DigestItem[] {
  const meta = metadataFor(items.map((i) => i.ratingKey));
  const seen =
    prefs.watchedBias === "new_to_me"
      ? watchedByUser(
          items.map((i) => i.ratingKey),
          userId,
        )
      : new Set<string>();

  const excludedTitles = new Set(prefs.excludedTitles.map((t) => t.toLowerCase()));
  const hated = new Set(prefs.genres.hated.map((g) => g.toLowerCase()));
  const loved = new Set(prefs.genres.loved.map((g) => g.toLowerCase()));
  const liked = new Set(prefs.genres.liked.map((g) => g.toLowerCase()));

  const kept = items.filter((item) => {
    if (excludedTitles.has(item.title.toLowerCase())) return false;
    if (seen.has(item.ratingKey)) return false;

    const row = meta.get(item.ratingKey);
    const genres = (row?.genres ?? []).map((g) => g.toLowerCase());

    // `strictHate` is the user's own switch: a hard exclude, or merely a
    // down-weight applied in the ranking below.
    if (prefs.strictHate && genres.some((g) => hated.has(g))) return false;
    if (prefs.ratingFloor != null && row?.rating != null && row.rating < prefs.ratingFloor) return false;
    if (prefs.eras.avoidBefore != null && item.year != null && item.year < prefs.eras.avoidBefore) return false;

    const maxMinutes = prefs.runtime?.maxMinutes;
    if (maxMinutes != null && row?.durationMs != null && row.durationMs > maxMinutes * 60_000) return false;

    return true;
  });

  const score = (item: DigestItem): number => {
    const row = meta.get(item.ratingKey);
    const genres = (row?.genres ?? []).map((g) => g.toLowerCase());
    let points = 0;
    if (genres.some((g) => loved.has(g))) points += 3;
    if (genres.some((g) => liked.has(g))) points += 1;
    if (!prefs.strictHate && genres.some((g) => hated.has(g))) points -= 2;
    if (item.year != null && prefs.eras.lovedDecades.includes(Math.floor(item.year / 10) * 10)) points += 1;
    if (row?.rating != null) points += row.rating / 10;
    return points;
  };

  return [...kept]
    .sort((a, b) => {
      const diff = score(b) - score(a);
      // Newest first within a score band, so a tie doesn't order by rating key.
      return diff !== 0 ? diff : (b.addedAt ?? 0) - (a.addedAt ?? 0);
    })
    .slice(0, cap);
}

interface ItemMetadata {
  genres: string[] | null;
  rating: number | null;
  contentRating: string | null;
  durationMs: number | null;
}

function metadataFor(ratingKeys: string[]): Map<string, ItemMetadata> {
  if (ratingKeys.length === 0) return new Map();
  const rows = db
    .select({
      ratingKey: mediaItems.ratingKey,
      genres: mediaItems.genres,
      rating: mediaItems.rating,
      contentRating: mediaItems.contentRating,
      durationMs: mediaItems.durationMs,
    })
    .from(mediaItems)
    .where(inArray(mediaItems.ratingKey, ratingKeys))
    .all();
  return new Map(rows.map((r) => [r.ratingKey, r]));
}

/** Which of these items this user has already played at all. */
function watchedByUser(ratingKeys: string[], userId: number): Set<string> {
  if (ratingKeys.length === 0) return new Set();
  const rows = db
    .select({ ratingKey: watchState.ratingKey })
    .from(watchState)
    .where(and(eq(watchState.userId, userId), inArray(watchState.ratingKey, ratingKeys), gte(watchState.plays, 1)))
    .all();
  return new Set(rows.map((r) => r.ratingKey));
}

/**
 * Is there anything here worth sending?
 *
 * A digest saying "nothing happened" trains people to ignore the channel, so
 * the job skips instead — and records that it skipped, which is the difference
 * between a quiet week and a broken one.
 */
export function isDigestEmpty(digest: Digest, minAddedItems: number): boolean {
  if (digest.added.length >= Math.max(1, minAddedItems)) return false;
  // A week with no new films but something about to be deleted is still worth
  // sending: it's the only warning the user gets.
  return digest.leavingSoon.length === 0;
}
