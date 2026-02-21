/**
 * Stats module — background sync of Plex stats to local SQLite cache.
 *
 * Sessions and recently added are refreshed on timers.
 * Most watched is synced via the "Sync Most Watched" job.
 */

import { eq } from "drizzle-orm";
import { db } from "./db/index.ts";
import { statsCache } from "./db/schema.ts";
import { createPlexClient } from "./plex.ts";
import { getConfig } from "./config.ts";
import type { PlexSession, PlexRecentItem } from "./plex.ts";

// ─── Cache helpers ────────────────────────────────────────────────────────────

function writeCache(key: string, data: unknown): void {
  const json = JSON.stringify(data);
  db.insert(statsCache)
    .values({ key, data: json, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: statsCache.key,
      set: { data: json, updatedAt: Date.now() },
    })
    .run();
}

function readCache<T>(key: string): T | null {
  const row = db.select().from(statsCache).where(eq(statsCache.key, key)).get();
  if (!row) return null;
  return JSON.parse(row.data) as T;
}

// ─── Plex client (returns null when not configured) ───────────────────────────

function tryGetPlexClient() {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) return null;
  return createPlexClient({ url: plexUrl, token: plexToken });
}

// ─── Sync functions ───────────────────────────────────────────────────────────

async function syncSessions(): Promise<void> {
  const client = tryGetPlexClient();
  if (!client) return;
  try {
    const sessions = await client.getActiveSessions();
    writeCache("sessions", sessions);
  } catch (err) {
    console.error("[stats] Failed to sync sessions:", (err as Error).message);
  }
}

async function syncRecentlyAdded(): Promise<void> {
  const client = tryGetPlexClient();
  if (!client) return;
  try {
    const recent = await client.getRecentlyAdded(20);
    writeCache("recentlyAdded", recent);
  } catch (err) {
    console.error("[stats] Failed to sync recently added:", (err as Error).message);
  }
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

export function getCachedSessions(): PlexSession[] {
  return readCache<PlexSession[]>("sessions") ?? [];
}

export function getCachedRecentlyAdded(): PlexRecentItem[] {
  return readCache<PlexRecentItem[]>("recentlyAdded") ?? [];
}

export function getCachedMostWatched(): MostWatchedItem[] {
  return readCache<MostWatchedItem[]>("mostWatched") ?? [];
}

// ─── Background timers ───────────────────────────────────────────────────────

let sessionsTimer: ReturnType<typeof setInterval> | null = null;
let recentlyAddedTimer: ReturnType<typeof setInterval> | null = null;

export function startStatsSync(): void {
  // Immediate first sync
  syncSessions();
  syncRecentlyAdded();

  // Sessions every 30s
  sessionsTimer = setInterval(syncSessions, 30_000);
  // Recently added every 5 minutes
  recentlyAddedTimer = setInterval(syncRecentlyAdded, 5 * 60_000);

  console.log("[stats] Background stats sync started");
}

export function stopStatsSync(): void {
  if (sessionsTimer) clearInterval(sessionsTimer);
  if (recentlyAddedTimer) clearInterval(recentlyAddedTimer);
}
