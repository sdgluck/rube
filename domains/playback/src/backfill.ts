/**
 * Seed playback history from Plex's own view log.
 *
 * A fresh install knows nothing, and every feature built on watch state —
 * cleanup rules, watched-by-all filters, digests — is useless until the poller
 * has run for weeks. `/status/sessions/history/all` closes that gap: it is a
 * real multi-user log of who viewed what and when, going back as far as the
 * server has kept it.
 *
 * What it is not is a substitute for the poller. A history entry carries an
 * account, a rating key and a timestamp — no completion percentage, no watched
 * duration, no player or transcode decision. Rows written here are marked
 * `source: "plex-history"` precisely so nothing downstream mistakes them for
 * observed plays and reads a `watchedMs` of 0 as "they bailed immediately".
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, playbackSessions, watchState } from "@tinkerbell/db";
import type { PlexHistoryItem } from "@tinkerbell/plex";

export const BACKFILL_SOURCE = "plex-history";

/** Page size for the history walk. Plex is comfortable here and it keeps the request count sane. */
const PAGE_SIZE = 500;

/**
 * Guards against an unbounded walk on a server with years of history. At
 * `PAGE_SIZE` this is 250k entries, far past any real library.
 */
const MAX_PAGES = 500;

/**
 * How close two plays must be to be considered the same one.
 *
 * The poller stamps `startedAt` when it first *sees* a session, while Plex
 * stamps `viewedAt` when the play is scrobbled — typically at the end. The two
 * can therefore differ by most of a film's runtime for the same play, so the
 * window has to be generous. Erring wide risks dropping a genuine rewatch that
 * started within the window; erring narrow double-counts every play observed by
 * both paths, which corrupts the rollup rather than merely thinning it.
 */
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface BackfillProgress {
  (scanned: number, imported: number): void;
}

export type HistoryPager = (opts: {
  limit: number;
  offset: number;
  viewedAfter?: number;
}) => Promise<PlexHistoryItem[]>;

/**
 * Walk the history endpoint page by page.
 *
 * Separated from the import so the termination logic — which is where an
 * off-by-one silently truncates someone's history — is testable without a DB
 * or a Plex. Terminates on a short page, an empty page, an abort, or the page
 * ceiling, whichever comes first.
 */
export async function* historyPages(
  fetchPage: HistoryPager,
  opts: { viewedAfter?: number; signal?: AbortSignal; pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<PlexHistoryItem[]> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  for (let page = 0, offset = 0; page < maxPages; page++, offset += pageSize) {
    if (opts.signal?.aborted) return;
    const items = await fetchPage({ limit: pageSize, offset, viewedAfter: opts.viewedAfter });
    if (items.length === 0) return;
    yield items;
    // A short page means we've reached the end. An exactly-full final page
    // doesn't, so termination still depends on the next response being empty.
    if (items.length < pageSize) return;
  }
}

export interface BackfillResult {
  scanned: number;
  imported: number;
  skipped: number;
  pages: number;
}

/**
 * A history entry, reduced to the fields we can honestly persist.
 * `viewedAt` is converted from Plex's seconds to our milliseconds here, once.
 */
function toRow(item: PlexHistoryItem): typeof playbackSessions.$inferInsert | null {
  if (!item.ratingKey || !item.viewedAt) return null;
  const at = item.viewedAt * 1000;
  return {
    id: randomUUID(),
    plexSessionKey: "",
    userId: item.accountID ?? 0,
    // Plex's history endpoint gives an account id but no username. The Users
    // page resolves the name via plex_users; storing a placeholder here rather
    // than a wrong name keeps the ambiguity visible.
    username: "",
    ratingKey: item.ratingKey,
    grandparentRatingKey: item.grandparentRatingKey ?? null,
    sectionId: item.librarySectionID ?? "",
    title: item.title ?? "",
    grandparentTitle: item.grandparentTitle ?? null,
    type: item.type ?? "",
    startedAt: at,
    lastSeenAt: at,
    endedAt: at,
    // Unknown, and deliberately left at zero rather than guessed. `source`
    // is what tells consumers these are absent rather than measured.
    durationMs: 0,
    watchedMs: 0,
    viewOffsetMs: 0,
    // Plex only logs an entry once it considers the item viewed, so treating
    // these as completed plays matches what the server itself believes.
    completionPct: 1,
    state: "completed",
    source: BACKFILL_SOURCE,
  };
}

/** True when we already have a play for this user and item close enough in time. */
function alreadyRecorded(userId: number, ratingKey: string, at: number): boolean {
  const hit = db
    .select({ id: playbackSessions.id })
    .from(playbackSessions)
    .where(
      and(
        eq(playbackSessions.userId, userId),
        eq(playbackSessions.ratingKey, ratingKey),
        gte(playbackSessions.startedAt, at - DEDUPE_WINDOW_MS),
        lte(playbackSessions.startedAt, at + DEDUPE_WINDOW_MS),
      ),
    )
    .get();
  return hit != null;
}

/** Timestamp of the newest backfilled row, so a re-run resumes rather than restarts. */
export function lastBackfilledAt(): number {
  const row = db
    .select({ at: sql<number | null>`max(${playbackSessions.startedAt})` })
    .from(playbackSessions)
    .where(eq(playbackSessions.source, BACKFILL_SOURCE))
    .get();
  return row?.at ?? 0;
}

/**
 * Walk Plex's view history and import what we don't already have.
 *
 * Takes a fetch function rather than a client so the paging and dedupe logic
 * can be exercised without a Plex server.
 */
export async function backfillFromHistory(
  fetchPage: HistoryPager,
  opts: { since?: number; signal?: AbortSignal; onProgress?: BackfillProgress } = {},
): Promise<BackfillResult> {
  // Resume from the newest row we already imported rather than re-walking
  // everything. Plex's `viewedAt>` filter is in seconds.
  const since = opts.since ?? lastBackfilledAt();
  const viewedAfter = since > 0 ? Math.floor(since / 1000) : undefined;

  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  let pages = 0;

  for await (const page of historyPages(fetchPage, { viewedAfter, signal: opts.signal })) {
    pages++;
    scanned += page.length;
    const rows = page.map(toRow).filter((r): r is typeof playbackSessions.$inferInsert => r != null);

    // One transaction per page rather than per row: a 20k-entry history is
    // 20k transactions otherwise, and the whole import takes minutes.
    db.transaction(() => {
      for (const row of rows) {
        if (alreadyRecorded(row.userId, row.ratingKey, row.startedAt)) {
          skipped++;
          continue;
        }
        db.insert(playbackSessions).values(row).run();
        foldIntoWatchState(row);
        imported++;
      }
    });

    opts.onProgress?.(scanned, imported);
  }

  return { scanned, imported, skipped, pages };
}

/**
 * Fold a backfilled play into the rollup.
 *
 * Kept separate from the poller's version because the inputs differ: a history
 * entry is always a completed play with no measurable watch time, so it must
 * add to `plays` and `completedPlays` but contribute nothing to
 * `totalWatchedMs` — adding zero is correct, adding a guess would not be.
 */
function foldIntoWatchState(row: typeof playbackSessions.$inferInsert): void {
  const at = row.startedAt;
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
        completedPlays: 1,
        firstPlayedAt: at,
        lastPlayedAt: at,
        totalWatchedMs: 0,
      })
      .run();
    return;
  }

  db.update(watchState)
    .set({
      plays: existing.plays + 1,
      completedPlays: existing.completedPlays + 1,
      firstPlayedAt: Math.min(existing.firstPlayedAt ?? at, at),
      lastPlayedAt: Math.max(existing.lastPlayedAt ?? at, at),
    })
    .where(and(eq(watchState.ratingKey, row.ratingKey), eq(watchState.userId, row.userId)))
    .run();
}
