/**
 * Stats module — background sync of Plex stats to local SQLite cache.
 *
 * Recently added and most watched are synced via jobs.
 * Sessions are fetched real-time (not cached here).
 */

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, statsCache, jobs, jobRuns, mediaItems, plexUsers } from "@tinkerbell/db";

const PROCESS_STARTED_AT_MS = Date.now();
import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { getConfig } from "@tinkerbell/core";
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

const mostWatchedItemSchema = z.object({
  ratingKey: z.string().optional(),
  title: z.string(),
  year: z.number().optional(),
  type: z.string(),
  grandparentTitle: z.string().optional(),
  plays: z.number(),
});

const activitySummarySchema = z.object({
  playsToday: z.number(),
  playsWeek: z.number(),
  activeUsersWeek: z.number(),
  topUserToday: z.object({ name: z.string(), plays: z.number() }).nullable().optional(),
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

function tryGetPlexClient() {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) return null;
  return createPlexClient({ url: plexUrl, token: plexToken, onHealth: plexHealthCallback });
}

// ─── Sync functions (called by jobs) ──────────────────────────────────────────

export async function syncRecentlyAdded(): Promise<string> {
  const client = tryGetPlexClient();
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
}

export async function syncMostWatched(): Promise<string> {
  const client = tryGetPlexClient();
  if (!client) throw new Error("Plex not configured");

  const history = await client.getWatchHistory({ limit: 1000 });
  const nowSec = Math.floor(Date.now() / 1000);
  const weekCutoff = nowSec - 7 * 86400;
  const todayCutoff = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const recentHistory = history.filter((item) => (item.viewedAt ?? 0) >= weekCutoff);

  let playsToday = 0;
  const usersThisWeek = new Set<number>();
  const playsByUserToday = new Map<number, number>();
  for (const item of recentHistory) {
    const isToday = (item.viewedAt ?? 0) >= todayCutoff;
    if (isToday) {
      playsToday++;
      if (item.accountID != null) {
        playsByUserToday.set(item.accountID, (playsByUserToday.get(item.accountID) ?? 0) + 1);
      }
    }
    if (item.accountID != null) usersThisWeek.add(item.accountID);
  }

  let topUserToday: { name: string; plays: number } | null = null;
  if (playsByUserToday.size > 0) {
    const [topId, topPlays] = [...playsByUserToday.entries()].sort((a, b) => b[1] - a[1])[0];
    const userRow = db
      .select({ name: plexUsers.name, username: plexUsers.username })
      .from(plexUsers)
      .where(eq(plexUsers.userId, topId))
      .get();
    topUserToday = { name: userRow?.name ?? userRow?.username ?? `User ${topId}`, plays: topPlays };
  }

  writeCache("activitySummary", {
    playsToday,
    playsWeek: recentHistory.length,
    activeUsersWeek: usersThisWeek.size,
    topUserToday,
  });

  const counts = new Map<string, MostWatchedItem>();
  for (const item of recentHistory) {
    const existing = counts.get(item.ratingKey);
    if (existing) {
      existing.plays++;
    } else {
      counts.set(item.ratingKey, {
        ratingKey: item.ratingKey,
        title: item.title,
        year: item.year,
        type: item.type,
        grandparentTitle: item.grandparentTitle,
        plays: 1,
      });
    }
  }

  const result = [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
  writeCache("mostWatched", result);
  return `Synced most watched: ${result.length} items from ${recentHistory.length} plays in the last 7 days`;
}

// ─── Read functions (called by tRPC endpoints) ───────────────────────────────

export function getCachedRecentlyAdded(): { items: PlexRecentItem[]; jobEnabled: boolean } {
  const items = readCache("recentlyAdded", z.array(plexRecentItemSchema)) ?? [];
  const job = db.select({ enabled: jobs.enabled }).from(jobs).where(eq(jobs.id, "sync-recently-added")).get();
  return { items, jobEnabled: job?.enabled === 1 };
}

export function getCachedMostWatched(): MostWatchedItem[] {
  return readCache("mostWatched", z.array(mostWatchedItemSchema)) ?? [];
}

export function getCachedActivitySummary(): {
  playsToday: number;
  playsWeek: number;
  activeUsersWeek: number;
  topUserToday: { name: string; plays: number } | null;
} {
  const cached = readCache("activitySummary", activitySummarySchema);
  return {
    playsToday: cached?.playsToday ?? 0,
    playsWeek: cached?.playsWeek ?? 0,
    activeUsersWeek: cached?.activeUsersWeek ?? 0,
    topUserToday: cached?.topUserToday ?? null,
  };
}

// ─── Operational summary (failed jobs, last sync, uptime) ───────────────────

export function getOpsSummary(): { failedJobs24h: number; lastSyncAt: number | null; uptimeSec: number } {
  const dayCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const failedJobs24h =
    db
      .select({ count: sql<number>`count(*)` })
      .from(jobRuns)
      .where(and(eq(jobRuns.status, "failed"), gte(jobRuns.startedAt, dayCutoff)))
      .get()?.count ?? 0;

  const lastSyncRow = db
    .select({ updatedAt: sql<number>`max(${statsCache.updatedAt})` })
    .from(statsCache)
    .get();

  return {
    failedJobs24h,
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

  const weekCutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
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
