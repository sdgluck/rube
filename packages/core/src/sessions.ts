/**
 * Portal login sessions + Plex client-identifier bootstrap for the
 * Sign-in-with-Plex flow. Sessions are opaque random tokens; only their
 * SHA-256 is stored, so a DB read can't be turned into a forged cookie.
 */
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db, plexSessions, plexUsers } from "@tinkerbell/db";
import { getConfig, setConfig } from "./config.ts";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Return the configured Plex client identifier, generating one on first use. */
export function ensurePlexClientId(): string {
  const existing = getConfig("global_plex_client_id");
  if (existing) return existing;
  const id = randomUUID();
  setConfig("global_plex_client_id", id);
  return id;
}

export interface PlexSession {
  userId: number;
  username: string;
}

/** Create a session and return the raw token to set as a cookie. */
export function createPlexSession(userId: number, username: string): string {
  const raw = randomBytes(32).toString("hex");
  const now = Date.now();
  db.insert(plexSessions)
    .values({ id: hashToken(raw), userId, username, createdAt: now, expiresAt: now + SESSION_TTL_MS })
    .run();
  return raw;
}

/** Resolve a raw cookie token to its session, or undefined if missing/expired. */
export function getPlexSession(raw: string | undefined): PlexSession | undefined {
  if (!raw) return undefined;
  const row = db
    .select()
    .from(plexSessions)
    .where(eq(plexSessions.id, hashToken(raw)))
    .get();
  if (!row) return undefined;
  if (row.expiresAt < Date.now()) {
    db.delete(plexSessions).where(eq(plexSessions.id, row.id)).run();
    return undefined;
  }
  return { userId: row.userId, username: row.username };
}

export function deletePlexSession(raw: string | undefined): void {
  if (!raw) return;
  db.delete(plexSessions)
    .where(eq(plexSessions.id, hashToken(raw)))
    .run();
}

export function prunePlexSessions(): void {
  db.delete(plexSessions).where(lt(plexSessions.expiresAt, Date.now())).run();
}

/** True if this Plex user id is a known user of this server (synced sharings). */
export function plexUserExists(userId: number): boolean {
  return !!db.select({ userId: plexUsers.userId }).from(plexUsers).where(eq(plexUsers.userId, userId)).get();
}
