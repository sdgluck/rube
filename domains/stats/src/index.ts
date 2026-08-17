/**
 * Stats module.
 *
 * Three different freshness strategies, deliberately:
 *   • Recently added — cached by a job, because it is a Plex call we don't
 *     want to make on every dashboard render.
 *   • Most watched and the activity tiles — queried live from
 *     `playback_sessions`, because we own that data locally and a cache would
 *     only add staleness.
 *   • Sessions — read straight from Plex, since "what is playing right now"
 *     is meaningless a minute later.
 */

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, statsCache, jobs, jobRuns, mediaItems, playbackSessions, plexUsers } from "@tinkerbell/db";

const PROCESS_STARTED_AT_MS = Date.now();
import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { configuredTimezone, getConfig, startOfLocalDay, DAY_MS, WEEK_MS } from "@tinkerbell/core";
import { topPlayed, type TopPlayedRank } from "@tinkerbell/domain.playback";
import type { PlexRecentItem } from "@tinkerbell/plex";

// ─── Cache helpers ────────────────────────────────────────────────────────────

const plexRecentItemSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  year: z.number().optional(),
  thumb: z.string().optional(),
  type: z.string(),
  addedAt: z.number(),
  grandparentTitle: z.string().optional(),
  parentTitle: z.string().optional(),
  container: z.string().optional(),
  videoResolution: z.string().optional(),
  fileSize: z.number().optional(),
});

function writeCache(key: string, data: unknown): void {
  db.insert(statsCache)
    .values({ key, data, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: statsCache.key,
      set: { data, updatedAt: Date.now() },
    })
    .run();
}

function readCache<T>(key: string, schema: z.ZodType<T>): T | null {
  const row = db.select().from(statsCache).where(eq(statsCache.key, key)).get();
  if (!row) return null;
  const parsed = schema.safeParse(row.data);
  if (!parsed.success) {
    console.warn(`[stats] cached "${key}" failed validation:`, parsed.error.message);
    return null;
  }
  return parsed.data;
}

// ─── Plex client (returns null when not configured) ───────────────────────────

function tryGetPlexClient(signal?: AbortSignal) {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) return null;
  return createPlexClient({ url: plexUrl, token: plexToken, signal, onHealth: plexHealthCallback });
}

// ─── Sync functions (called by jobs) ──────────────────────────────────────────

export async function syncRecentlyAdded(signal?: AbortSignal): Promise<string> {
  const client = tryGetPlexClient(signal);
  if (!client) throw new Error("Plex not configured");
  const recent = await client.getRecentlyAdded(20);
  writeCache("recentlyAdded", recent);
  return `Synced ${recent.length} recently added items`;
}

export interface MostWatchedItem {
  ratingKey?: string;
  title: string;
  year?: number;
  type: string;
  grandparentTitle?: string;
  plays: number;
  /** Distinct people who played it — a rewatcher counts once. */
  viewers: number;
}

// ─── Read functions (called by tRPC endpoints) ───────────────────────────────

export function getCachedRecentlyAdded(): { items: PlexRecentItem[]; jobEnabled: boolean } {
  const items = readCache("recentlyAdded", z.array(plexRecentItemSchema)) ?? [];
  const job = db.select({ enabled: jobs.enabled }).from(jobs).where(eq(jobs.id, "sync-recently-added")).get();
  return { items, jobEnabled: job?.enabled === 1 };
}

/**
 * Most-played items in a period.
 *
 * Was a cached hourly snapshot of Plex's view log, capped at whatever the last
 * 1,000 history entries happened to cover. Now a direct query over our own
 * playback history, which makes the period selectable and the numbers exact —
 * and removes an entire scheduled job.
 */
export function getMostWatched(opts: { since?: number; limit?: number; rank?: TopPlayedRank } = {}): MostWatchedItem[] {
  const since = opts.since ?? Date.now() - WEEK_MS;
  return topPlayed({ since, limit: opts.limit ?? 10, rank: opts.rank }).map((row) => ({
    ratingKey: row.ratingKey,
    title: row.title,
    type: row.type,
    grandparentTitle: row.grandparentTitle ?? undefined,
    plays: row.plays,
    viewers: row.viewers,
  }));
}

/**
 * Dashboard activity tiles.
 *
 * Derived from `playback_sessions` rather than a cached job result. On an
 * install that has just upgraded these read zero until either the poller has
 * ticked or `playback-backfill` has run — which is honest, where the old cache
 * would have gone stale and kept showing last hour's numbers forever.
 */
export function getActivitySummary(now: number = Date.now()): {
  playsToday: number;
  playsWeek: number;
  activeUsersWeek: number;
  topUserToday: { name: string; plays: number } | null;
} {
  const weekCutoff = now - WEEK_MS;
  // Midnight where the server is configured to live, not where the container
  // runs: a UTC container set to `America/Los_Angeles` rolled "today" over at
  // 17:00 local, and disagreed with the digest, which has always done this
  // properly, and with every cron-scheduled day window.
  const todayCutoff = startOfLocalDay(now, configuredTimezone());

  const week = db
    .select({
      plays: sql<number>`count(*)`,
      users: sql<number>`count(distinct ${playbackSessions.userId})`,
    })
    .from(playbackSessions)
    .where(gte(playbackSessions.startedAt, weekCutoff))
    .get() ?? { plays: 0, users: 0 };

  const playsToday =
    db
      .select({ count: sql<number>`count(*)` })
      .from(playbackSessions)
      .where(gte(playbackSessions.startedAt, todayCutoff))
      .get()?.count ?? 0;

  const top = db
    .select({ userId: playbackSessions.userId, plays: sql<number>`count(*)` })
    .from(playbackSessions)
    .where(gte(playbackSessions.startedAt, todayCutoff))
    .groupBy(playbackSessions.userId)
    .orderBy(sql`count(*) desc`)
    .limit(1)
    .get();

  let topUserToday: { name: string; plays: number } | null = null;
  if (top) {
    const userRow = db
      .select({ name: plexUsers.name, username: plexUsers.username })
      .from(plexUsers)
      .where(eq(plexUsers.userId, top.userId))
      .get();
    topUserToday = { name: userRow?.name ?? userRow?.username ?? `User ${top.userId}`, plays: top.plays };
  }

  return {
    playsToday,
    playsWeek: week.plays,
    activeUsersWeek: week.users,
    topUserToday,
  };
}

/**
 * Plays per day, oldest first, the last entry being today so far.
 *
 * Bucketed by integer division from midnight in the configured timezone rather
 * than SQLite's `date()`, which buckets by UTC and would cut the day in the
 * wrong place for anyone west of Greenwich. The boundaries are therefore fixed
 * 24h steps from there: a DST change inside the window shifts one of them by an
 * hour, which is invisible in a sparkline and not worth a per-row conversion.
 */
export function getActivitySeries(days: number, now: number = Date.now()): number[] {
  const start = startOfLocalDay(now, configuredTimezone()) - (days - 1) * DAY_MS;
  const rows = db
    .select({
      bucket: sql<number>`cast((${playbackSessions.startedAt} - ${start}) / ${DAY_MS} as integer)`,
      plays: sql<number>`count(*)`,
    })
    .from(playbackSessions)
    .where(gte(playbackSessions.startedAt, start))
    .groupBy(sql`1`)
    .all();

  const series: number[] = Array.from({ length: days }, () => 0);
  for (const row of rows) {
    if (row.bucket >= 0 && row.bucket < days) series[row.bucket] = row.plays;
  }
  return series;
}

// ─── Operational summary (failed jobs, last sync, uptime) ───────────────────

export interface LastFailedRun {
  runId: string;
  jobId: string;
  name: string;
  startedAt: number;
}

/**
 * The most recent run that failed, whatever the job has done since.
 *
 * One definition of "last failure", used by both the Stats tile and the Jobs
 * tile — they read the same row, so they cannot say different things. Note
 * this is deliberately NOT "jobs whose latest run failed": a job that failed
 * three hours ago and has succeeded twice since still failed three hours ago,
 * and a dashboard that forgets that disagrees with its own event log.
 *
 * `since` bounds it to a window (the Stats tile counts a day); omit it for
 * "ever".
 */
export function getLastFailedRun(since?: number): LastFailedRun | null {
  const where =
    since == null ? eq(jobRuns.status, "failed") : and(eq(jobRuns.status, "failed"), gte(jobRuns.startedAt, since));

  const row = db
    .select({ runId: jobRuns.id, jobId: jobRuns.jobId, name: jobs.name, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .leftJoin(jobs, eq(jobs.id, jobRuns.jobId))
    .where(where)
    .orderBy(sql`${jobRuns.startedAt} desc`)
    .limit(1)
    .get();

  if (!row) return null;
  return { runId: row.runId, jobId: row.jobId, name: row.name ?? row.jobId, startedAt: row.startedAt };
}

export function getOpsSummary(): {
  failedJobs24h: number;
  lastFailure: LastFailedRun | null;
  lastSyncAt: number | null;
  uptimeSec: number;
} {
  const dayCutoff = Date.now() - DAY_MS;
  const failedJobs24h =
    db
      .select({ count: sql<number>`count(*)` })
      .from(jobRuns)
      .where(and(eq(jobRuns.status, "failed"), gte(jobRuns.startedAt, dayCutoff)))
      .get()?.count ?? 0;

  // A count on its own says something is wrong without saying what. The most
  // recent failure names the job, which is the whole of what the dashboard can
  // usefully say before you click through.
  const lastFailure = getLastFailedRun(dayCutoff);

  const lastSyncRow = db
    .select({ updatedAt: sql<number>`max(${statsCache.updatedAt})` })
    .from(statsCache)
    .get();

  return {
    failedJobs24h,
    lastFailure,
    lastSyncAt: lastSyncRow?.updatedAt ?? null,
    uptimeSec: Math.floor((Date.now() - PROCESS_STARTED_AT_MS) / 1000),
  };
}

// ─── Library overview (aggregated from local cache) ─────────────────────────

export function getLibraryOverview() {
  const totalItems =
    db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .get()?.count ?? 0;
  const userCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(plexUsers)
      .get()?.count ?? 0;

  const resolutions = db
    .select({ value: mediaItems.videoResolution, count: sql<number>`count(*)` })
    .from(mediaItems)
    .where(isNotNull(mediaItems.videoResolution))
    .groupBy(mediaItems.videoResolution)
    .all();

  const videoCodecs = db
    .select({ value: mediaItems.videoCodec, count: sql<number>`count(*)` })
    .from(mediaItems)
    .where(isNotNull(mediaItems.videoCodec))
    .groupBy(mediaItems.videoCodec)
    .all();

  const audioCodecs = db
    .select({ value: mediaItems.audioCodec, count: sql<number>`count(*)` })
    .from(mediaItems)
    .where(isNotNull(mediaItems.audioCodec))
    .groupBy(mediaItems.audioCodec)
    .all();

  const weekCutoff = Math.floor((Date.now() - WEEK_MS) / 1000);
  const addedThisWeek =
    db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .where(gte(mediaItems.addedAt, weekCutoff))
      .get()?.count ?? 0;

  const typeCounts = db
    .select({ type: mediaItems.type, count: sql<number>`count(*)` })
    .from(mediaItems)
    .groupBy(mediaItems.type)
    .all();
  const movieCount = typeCounts.find((t) => t.type === "movie")?.count ?? 0;
  const showCount = typeCounts.find((t) => t.type === "show")?.count ?? 0;
  const episodeCount = typeCounts.find((t) => t.type === "episode")?.count ?? 0;

  const count4k =
    db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .where(eq(mediaItems.videoResolution, "4k"))
      .get()?.count ?? 0;

  return {
    totalItems,
    userCount,
    resolutions,
    videoCodecs,
    audioCodecs,
    addedThisWeek,
    movieCount,
    showCount,
    episodeCount,
    count4k,
  };
}
