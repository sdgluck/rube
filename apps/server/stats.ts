/**
 * Stats module — background sync of Plex stats to local SQLite cache.
 *
 * Recently added and most watched are synced via jobs.
 * Sessions are fetched real-time (not cached here).
 */

import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { statsCache, jobs, mediaItems, plexUsers } from "./db/schema.ts";
import { createPlexClient } from "./plex.ts";
import { getConfig } from "./config.ts";
import type { PlexRecentItem } from "./plex.ts";

// ─── Cache helpers ────────────────────────────────────────────────────────────

function writeCache(key: string, data: unknown): void {
  db.insert(statsCache)
    .values({ key, data, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: statsCache.key,
      set: { data, updatedAt: Date.now() },
    })
    .run();
}

function readCache<T>(key: string): T | null {
  const row = db.select().from(statsCache).where(eq(statsCache.key, key)).get();
  if (!row) return null;
  return row.data as T;
}

// ─── Plex client (returns null when not configured) ───────────────────────────

function tryGetPlexClient() {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) return null;
  return createPlexClient({ url: plexUrl, token: plexToken });
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
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const recentHistory = history.filter((item) => (item.viewedAt ?? 0) >= cutoff);

  const counts = new Map<string, MostWatchedItem>();
  for (const item of recentHistory) {
    const existing = counts.get(item.ratingKey);
    if (existing) {
      existing.plays++;
    } else {
      counts.set(item.ratingKey, {
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
  const items = readCache<PlexRecentItem[]>("recentlyAdded") ?? [];
  const job = db.select({ enabled: jobs.enabled }).from(jobs).where(eq(jobs.id, "sync-recently-added")).get();
  return { items, jobEnabled: job?.enabled === 1 };
}

export function getCachedMostWatched(): MostWatchedItem[] {
  return readCache<MostWatchedItem[]>("mostWatched") ?? [];
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

  return { totalItems, userCount, resolutions, videoCodecs, audioCodecs };
}
