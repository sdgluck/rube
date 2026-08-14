/**
 * Tinkerbell's own watch record — persistence and queries.
 *
 * Plex answers "what is playing right now" (`/status/sessions`) and "who viewed
 * what, when" (`/status/sessions/history/all`). It does not answer "how much of
 * it did they actually watch", "did everyone finish this", or "what was the
 * transcode decision" — and those are the questions collections, cleanup rules
 * and digests are built on. So we sample the live session and keep the log.
 *
 * Two tables: `playback_sessions` is the event log, `watch_state` the per
 * (item, user) rollup maintained as sessions close. Read paths use the rollup;
 * only the history UI reads the log.
 */
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getConfig, DAY_MS } from "@tinkerbell/core";
import { db, playbackSessions, plexUsers, watchState } from "@tinkerbell/db";
import type { PlexSession } from "@tinkerbell/plex";
import { diffSnapshot, staleCloses, type OpenSession, type SessionClose } from "./diff.ts";

/** Poll cadence. Also the yardstick `diffSnapshot` uses to tell playback from a seek. */
export const POLL_INTERVAL_MS = 30_000;

/**
 * How long an untouched open row survives before it is closed as `stale`.
 *
 * Three missed ticks rather than one: a single slow poll (a Plex mid-transcode,
 * a busy host) must not close a session that is still playing, because closing
 * it would both truncate the play and open a duplicate row on the next tick.
 */
export const STALE_AFTER_MS = POLL_INTERVAL_MS * 3;

export const DEFAULT_COMPLETION_THRESHOLD = 0.85;

/** The single definition of "watched", read from config in one place. */
export function completionThreshold(): number {
  return getConfig("playback_completion_threshold") ?? DEFAULT_COMPLETION_THRESHOLD;
}

function openSessions(): OpenSession[] {
  return db
    .select({
      id: playbackSessions.id,
      plexSessionKey: playbackSessions.plexSessionKey,
      userId: playbackSessions.userId,
      ratingKey: playbackSessions.ratingKey,
      startedAt: playbackSessions.startedAt,
      lastSeenAt: playbackSessions.lastSeenAt,
      durationMs: playbackSessions.durationMs,
      watchedMs: playbackSessions.watchedMs,
      viewOffsetMs: playbackSessions.viewOffsetMs,
      state: playbackSessions.state,
    })
    .from(playbackSessions)
    .where(isNull(playbackSessions.endedAt))
    .all();
}

/**
 * Fold one closed session into `watch_state`.
 *
 * Incremental rather than recomputed: the alternative is aggregating the whole
 * session log every time a rule asks whether an item has been watched, which
 * puts a table scan inside the generate loop. `rebuildWatchState` exists for
 * when this drifts.
 *
 * A `stale` close counts as a play but never a completed one — we lost track of
 * the session and genuinely don't know whether it finished.
 */
function applyToWatchState(close: SessionClose, row: { ratingKey: string; userId: number }, threshold: number): void {
  const completed = close.state === "completed" || close.completionPct >= threshold ? 1 : 0;
  const completedPlays = close.state === "stale" ? 0 : completed;
  const existing = db
    .select()
    .from(watchState)
    .where(and(eq(watchState.ratingKey, row.ratingKey), eq(watchState.userId, row.userId)))
    .get();

  if (!existing) {
    db.insert(watchState)
      .values({
        ratingKey: row.ratingKey,
        userId: row.userId,
        plays: 1,
        completedPlays,
        firstPlayedAt: close.endedAt,
        lastPlayedAt: close.endedAt,
        totalWatchedMs: close.watchedMs,
        maxCompletionPct: close.completionPct,
      })
      .run();
    return;
  }

  db.update(watchState)
    .set({
      plays: existing.plays + 1,
      completedPlays: existing.completedPlays + completedPlays,
      firstPlayedAt: Math.min(existing.firstPlayedAt ?? close.endedAt, close.endedAt),
      lastPlayedAt: Math.max(existing.lastPlayedAt ?? close.endedAt, close.endedAt),
      totalWatchedMs: existing.totalWatchedMs + close.watchedMs,
      // High-water mark, including stale closes: we lost the session, but the
      // offset we last saw was genuinely reached, and under-reporting it would
      // wrongly file the item under "everyone bounced off this".
      maxCompletionPct: Math.max(existing.maxCompletionPct, close.completionPct),
    })
    .where(and(eq(watchState.ratingKey, row.ratingKey), eq(watchState.userId, row.userId)))
    .run();
}

function persistCloses(closes: SessionClose[], threshold: number): void {
  if (closes.length === 0) return;
  const rows = db
    .select({ id: playbackSessions.id, ratingKey: playbackSessions.ratingKey, userId: playbackSessions.userId })
    .from(playbackSessions)
    .where(
      inArray(
        playbackSessions.id,
        closes.map((c) => c.id),
      ),
    )
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const close of closes) {
    const row = byId.get(close.id);
    if (!row) continue;
    db.update(playbackSessions)
      .set({
        endedAt: close.endedAt,
        watchedMs: close.watchedMs,
        viewOffsetMs: close.viewOffsetMs,
        completionPct: close.completionPct,
        state: close.state,
      })
      .where(eq(playbackSessions.id, close.id))
      .run();
    applyToWatchState(close, row, threshold);
  }
}

/**
 * Apply one `/status/sessions` sample.
 *
 * Takes the session array rather than fetching it so the caller owns the Plex
 * round trip and the whole state machine stays testable without one.
 *
 * The entire diff is applied in a single transaction: a crash between closing a
 * row and folding it into `watch_state` would otherwise lose a play or, worse,
 * double-count it on the retry.
 */
export function recordPollSnapshot(sessions: PlexSession[], now: number): { opened: number; closed: number } {
  const threshold = completionThreshold();
  const diff = diffSnapshot(openSessions(), sessions, now, {
    completionThreshold: threshold,
    intervalMs: POLL_INTERVAL_MS,
  });

  db.transaction(() => {
    for (const open of diff.opens) {
      db.insert(playbackSessions)
        .values({ id: randomUUID(), source: "poller", ...open })
        .run();
    }
    for (const update of diff.updates) {
      const { id, ...set } = update;
      db.update(playbackSessions).set(set).where(eq(playbackSessions.id, id)).run();
    }
    persistCloses(diff.closes, threshold);
  });

  return { opened: diff.opens.length, closed: diff.closes.length };
}

/**
 * Close rows the poller lost track of. Called at boot, before the first poll:
 * without it a process restart mid-film orphans the row forever, and the next
 * sighting of that session opens a second one alongside it.
 */
export function closeStaleSessions(now: number, cutoffMs: number = STALE_AFTER_MS): number {
  const closes = staleCloses(openSessions(), now, cutoffMs);
  if (closes.length === 0) return 0;
  const threshold = completionThreshold();
  db.transaction(() => persistCloses(closes, threshold));
  return closes.length;
}

export interface WatchStateRow {
  ratingKey: string;
  userId: number;
  plays: number;
  completedPlays: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  totalWatchedMs: number;
  /** 0–1. Furthest this user got in any single play. */
  maxCompletionPct: number;
}

/** Watch state for a set of items, optionally narrowed to one user. */
export function watchStateFor(ratingKeys: string[], userId?: number): Map<string, WatchStateRow[]> {
  const out = new Map<string, WatchStateRow[]>();
  if (ratingKeys.length === 0) return out;

  // SQLite caps host parameters (999 by default), and a rule can hand us a
  // whole section's worth of rating keys.
  const CHUNK = 500;
  for (let i = 0; i < ratingKeys.length; i += CHUNK) {
    const chunk = ratingKeys.slice(i, i + CHUNK);
    const where =
      userId == null
        ? inArray(watchState.ratingKey, chunk)
        : and(inArray(watchState.ratingKey, chunk), eq(watchState.userId, userId));
    for (const row of db.select().from(watchState).where(where).all()) {
      const list = out.get(row.ratingKey) ?? [];
      list.push(row);
      out.set(row.ratingKey, list);
    }
  }
  return out;
}

/**
 * Whether every user in `userIds` has a completed play of the item.
 *
 * An empty user set is `false`, never `true`. The vacuous reading — "everyone
 * has watched it because there is no one" — would mark an entire library as
 * fully watched on a fresh install, and with cleanup rules wired up that is a
 * library-deleting bug rather than a cosmetic one.
 */
export function isWatchedByAll(ratingKey: string, userIds: number[]): boolean {
  if (userIds.length === 0) return false;
  const rows = db
    .select({ userId: watchState.userId })
    .from(watchState)
    .where(and(eq(watchState.ratingKey, ratingKey), gte(watchState.completedPlays, 1)))
    .all();
  const watched = new Set(rows.map((r) => r.userId));
  return userIds.every((id) => watched.has(id));
}

export interface WatchStateUserScope {
  userIds: number[];
  /** Resolved names, in the same order — for the run log. */
  usernames: string[];
  includeOwner: boolean;
}

/**
 * Who "everyone" means for `tb.watchedByAll`.
 *
 * Every user synced from Plex, with the owner excluded unless
 * `watch_state_all_users_include_owner` says otherwise.
 *
 * Deliberately *not* gated on the personalization opt-in, though that was the
 * obvious candidate: opting in is a portal switch about home-screen
 * personalization, and most people sharing a server never open the portal at
 * all. Scoping to it would make "everyone" mean nobody on a typical install —
 * `watchedByAll` would match nothing, permanently and silently. Sharing the
 * library is the consent that matters here; whether someone customised their
 * home screen says nothing about whether they've watched a film.
 *
 * The caller is expected to log the resolved list. A rule that deletes things
 * has to make its definition of "everyone" visible in the run log, and an
 * empty list — which makes `watchedByAll` false for everything — is otherwise
 * indistinguishable from a library nobody has finished.
 */
export function watchStateUserScope(): WatchStateUserScope {
  const includeOwner = getConfig("watch_state_all_users_include_owner") ?? false;
  const rows = db
    .select({ userId: plexUsers.userId, username: plexUsers.username, name: plexUsers.name })
    .from(plexUsers)
    .where(includeOwner ? undefined : eq(plexUsers.isOwner, 0))
    .orderBy(asc(plexUsers.username))
    .all();

  return {
    userIds: rows.map((r) => r.userId),
    usernames: rows.map((r) => r.name || r.username || `User ${r.userId}`),
    includeOwner,
  };
}

export interface WatchHistoryCoverage {
  sessions: number;
  /** Epoch ms of the earliest recorded play, or null when there are none. */
  earliestAt: number | null;
  /** Whole days between the earliest play and now. */
  days: number;
}

/**
 * How much history there is to filter on.
 *
 * The single most likely support question about watch-state filters is a user
 * adding "watched by nobody", getting their entire library back, and concluding
 * it's broken — when in fact the poller has been running for two days. The
 * editors read this to warn before that happens.
 */
export function watchHistoryCoverage(now: number = Date.now()): WatchHistoryCoverage {
  const row = db
    .select({
      sessions: sql<number>`count(*)`,
      earliestAt: sql<number | null>`min(${playbackSessions.startedAt})`,
    })
    .from(playbackSessions)
    .get();

  const earliestAt = row?.earliestAt ?? null;
  return {
    sessions: row?.sessions ?? 0,
    earliestAt,
    days: earliestAt == null ? 0 : Math.max(0, Math.floor((now - earliestAt) / DAY_MS)),
  };
}

export interface WatchSummary {
  ratingKey: string;
  title: string;
  grandparentTitle: string | null;
  type: string;
  plays: number;
  totalWatchedMs: number;
  lastPlayedAt: number | null;
}

/**
 * Most-played items in a period.
 *
 * Reads the session log rather than `watch_state` because the rollup has no
 * notion of a period — it is a lifetime total by design. A period query over an
 * indexed `started_at` is cheap; keeping per-period counters would not be.
 */
export function topPlayed(opts: { since: number; limit: number; userId?: number; type?: string }): WatchSummary[] {
  const filters = [gte(playbackSessions.startedAt, opts.since)];
  if (opts.userId != null) filters.push(eq(playbackSessions.userId, opts.userId));
  if (opts.type) filters.push(eq(playbackSessions.type, opts.type));

  return db
    .select({
      ratingKey: playbackSessions.ratingKey,
      title: sql<string>`max(${playbackSessions.title})`,
      grandparentTitle: sql<string | null>`max(${playbackSessions.grandparentTitle})`,
      type: sql<string>`max(${playbackSessions.type})`,
      plays: sql<number>`count(*)`,
      totalWatchedMs: sql<number>`coalesce(sum(${playbackSessions.watchedMs}), 0)`,
      lastPlayedAt: sql<number | null>`max(${playbackSessions.startedAt})`,
    })
    .from(playbackSessions)
    .where(and(...filters))
    .groupBy(playbackSessions.ratingKey)
    .orderBy(desc(sql`count(*)`))
    .limit(opts.limit)
    .all();
}

export type PlaybackRow = typeof playbackSessions.$inferSelect;

/** Columns the history panel can order by. */
export const HISTORY_SORTS = ["when", "title", "user", "device", "play", "watched"] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

/**
 * Sort expressions per column. `title` orders by what the UI actually renders
 * (show first for episodes) rather than the bare episode title, which would
 * scatter a show's episodes across the list.
 */
const HISTORY_SORT_COLUMNS = {
  when: playbackSessions.startedAt,
  title: sql`coalesce(${playbackSessions.grandparentTitle}, '') || ${playbackSessions.title}`,
  user: sql`coalesce(nullif(${plexUsers.name}, ''), nullif(${plexUsers.username}, ''), nullif(${playbackSessions.username}, ''), 'User ' || ${playbackSessions.userId})`,
  device: playbackSessions.player,
  play: playbackSessions.decision,
  watched: playbackSessions.watchedMs,
} as const;

/**
 * Columns where a blank cell means "we never recorded this" (backfilled rows
 * carry no device or transcode decision). Those sort to the end in both
 * directions — an ascending sort by Device otherwise opens on a page of dashes.
 */
const HISTORY_SORT_BLANKS_LAST: Partial<Record<HistorySort, boolean>> = { device: true, play: true };

/** Paginated raw history, newest first — the Stats history panel. */
export function serverHistory(opts: {
  since?: number;
  until?: number;
  userId?: number;
  ratingKey?: string;
  limit: number;
  offset: number;
  sort?: HistorySort;
  dir?: "asc" | "desc";
}): { rows: PlaybackRow[]; total: number } {
  const filters = [];
  if (opts.since != null) filters.push(gte(playbackSessions.startedAt, opts.since));
  if (opts.until != null) filters.push(lte(playbackSessions.startedAt, opts.until));
  if (opts.userId != null) filters.push(eq(playbackSessions.userId, opts.userId));
  if (opts.ratingKey) filters.push(eq(playbackSessions.ratingKey, opts.ratingKey));
  const where = filters.length ? and(...filters) : undefined;

  const total =
    db
      .select({ count: sql<number>`count(*)` })
      .from(playbackSessions)
      .where(where)
      .get()?.count ?? 0;

  const sort = opts.sort ?? "when";
  const sortColumn = HISTORY_SORT_COLUMNS[sort];
  const direction = opts.dir === "asc" ? asc : desc;
  const orderBy = [];
  if (HISTORY_SORT_BLANKS_LAST[sort]) orderBy.push(asc(sql`case when ${sortColumn} = '' then 1 else 0 end`));
  orderBy.push(direction(sortColumn));
  // Ties (a show's episodes, a user's run of plays) keep a stable, meaningful
  // order rather than whatever SQLite happens to return.
  if (sort !== "when") orderBy.push(desc(playbackSessions.startedAt));

  // `username` on the session is whatever Plex reported at play time — empty for
  // rows reconstructed by backfill. Resolving against `plex_users` here means
  // every caller gets a name rather than an account id.
  const rows = db
    .select({ ...getTableColumns(playbackSessions), name: plexUsers.name, pusername: plexUsers.username })
    .from(playbackSessions)
    .leftJoin(plexUsers, eq(plexUsers.userId, playbackSessions.userId))
    .where(where)
    .orderBy(...orderBy)
    .limit(opts.limit)
    .offset(opts.offset)
    .all();

  return {
    rows: rows.map(({ name, pusername, ...row }) => ({
      ...row,
      username: name || pusername || row.username || `User ${row.userId}`,
    })),
    total,
  };
}

export interface WatchedByRow extends WatchStateRow {
  /** Resolved from `plex_users`; falls back to the raw id for accounts we've never synced. */
  username: string;
}

/**
 * Who has watched an item, for the Media detail "Watched by" line.
 *
 * Resolves display names here rather than in the UI: `watch_state` is keyed by
 * account id only, and every caller would otherwise have to join `plex_users`
 * itself.
 */
export function watchedBy(ratingKey: string): WatchedByRow[] {
  const rows = db
    .select({
      ratingKey: watchState.ratingKey,
      userId: watchState.userId,
      plays: watchState.plays,
      completedPlays: watchState.completedPlays,
      firstPlayedAt: watchState.firstPlayedAt,
      lastPlayedAt: watchState.lastPlayedAt,
      totalWatchedMs: watchState.totalWatchedMs,
      maxCompletionPct: watchState.maxCompletionPct,
      name: plexUsers.name,
      pusername: plexUsers.username,
    })
    .from(watchState)
    .leftJoin(plexUsers, eq(plexUsers.userId, watchState.userId))
    .where(and(eq(watchState.ratingKey, ratingKey), gte(watchState.plays, 1)))
    .orderBy(desc(watchState.lastPlayedAt))
    .all();

  return rows.map(({ name, pusername, ...row }) => ({
    ...row,
    username: name || pusername || `User ${row.userId}`,
  }));
}

/**
 * Plays and watch time for every user in one query.
 *
 * The Users page renders a row per user; asking per row would be N round trips
 * for what SQLite answers as a single grouped scan.
 */
export function allUserTotals(since?: number): Map<number, { plays: number; watchedMs: number }> {
  const rows = db
    .select({
      userId: playbackSessions.userId,
      plays: sql<number>`count(*)`,
      watchedMs: sql<number>`coalesce(sum(${playbackSessions.watchedMs}), 0)`,
    })
    .from(playbackSessions)
    .where(since == null ? undefined : gte(playbackSessions.startedAt, since))
    .groupBy(playbackSessions.userId)
    .all();
  return new Map(rows.map((r) => [r.userId, { plays: r.plays, watchedMs: r.watchedMs }]));
}

/** Lifetime totals for one user — the Users page. */
export function userTotals(userId: number, since?: number): { plays: number; watchedMs: number } {
  const filters = [eq(playbackSessions.userId, userId)];
  if (since != null) filters.push(gte(playbackSessions.startedAt, since));
  const row = db
    .select({
      plays: sql<number>`count(*)`,
      watchedMs: sql<number>`coalesce(sum(${playbackSessions.watchedMs}), 0)`,
    })
    .from(playbackSessions)
    .where(and(...filters))
    .get();
  return { plays: row?.plays ?? 0, watchedMs: row?.watchedMs ?? 0 };
}

/**
 * Recompute `watch_state` from the session log.
 *
 * A repair tool, exposed as a maintenance action and never run automatically —
 * if the incremental path has a bug, running this on a schedule would hide it
 * rather than fix it. Only closed sessions count; an open one hasn't happened yet.
 */
export function rebuildWatchState(): number {
  const threshold = completionThreshold();
  return db.transaction(() => {
    db.delete(watchState).run();
    const rows = db
      .select()
      .from(playbackSessions)
      .where(sql`${playbackSessions.endedAt} is not null`)
      .all();

    const acc = new Map<string, typeof watchState.$inferInsert>();
    for (const row of rows) {
      const key = `${row.ratingKey} ${row.userId}`;
      const completed = row.state !== "stale" && row.completionPct >= threshold ? 1 : 0;
      const at = row.endedAt ?? row.startedAt;
      const existing = acc.get(key);
      if (!existing) {
        acc.set(key, {
          ratingKey: row.ratingKey,
          userId: row.userId,
          plays: 1,
          completedPlays: completed,
          firstPlayedAt: at,
          lastPlayedAt: at,
          totalWatchedMs: row.watchedMs,
          maxCompletionPct: row.completionPct,
        });
        continue;
      }
      existing.plays = (existing.plays ?? 0) + 1;
      existing.completedPlays = (existing.completedPlays ?? 0) + completed;
      existing.firstPlayedAt = Math.min(existing.firstPlayedAt ?? at, at);
      existing.lastPlayedAt = Math.max(existing.lastPlayedAt ?? at, at);
      existing.totalWatchedMs = (existing.totalWatchedMs ?? 0) + row.watchedMs;
      existing.maxCompletionPct = Math.max(existing.maxCompletionPct ?? 0, row.completionPct);
    }

    for (const value of acc.values()) db.insert(watchState).values(value).run();
    return acc.size;
  });
}

/**
 * Prune raw session rows past the retention window.
 *
 * `watch_state` is deliberately untouched — it is the summary that has to
 * outlive the log, and rebuilding it from a pruned log would silently erase
 * every play older than the window.
 */
export function pruneOldSessions(now: number): number {
  const days = getConfig("playback_retention_days") ?? 0;
  if (days <= 0) return 0;
  const cutoff = now - days * DAY_MS;
  return db
    .delete(playbackSessions)
    .where(and(lt(playbackSessions.startedAt, cutoff), sql`${playbackSessions.endedAt} is not null`))
    .run().changes;
}
