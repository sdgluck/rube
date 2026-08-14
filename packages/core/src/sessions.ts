/**
 * Login sessions + Plex client-identifier bootstrap for the Sign-in-with-Plex
 * flow, shared by the user portal and the admin app. Sessions are opaque
 * random tokens; only their SHA-256 is stored, so a DB read can't be turned
 * into a forged cookie.
 *
 * Every session carries a scope. A portal session belongs to any shared user;
 * an admin session belongs to the server owner. They live in one table but are
 * not interchangeable, and `getPlexSession` takes the required scope as a
 * mandatory argument so a call site cannot forget to say which it wants — an
 * optional parameter with a permissive default is exactly the bug this guards
 * against.
 */
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db, plexSessions, plexUsers } from "@tinkerbell/db";
import { getConfig, setConfig } from "./config.ts";

export type SessionScope = "portal" | "admin";

/**
 * Portal sessions are long-lived because the portal is a low-privilege,
 * user-facing page people return to occasionally. An admin session can delete
 * every collection on the server, so it expires far sooner — kept alive by
 * sliding refresh for as long as the admin is actually using the app.
 */
const SESSION_TTL_MS: Record<SessionScope, number> = {
  portal: 30 * 24 * 60 * 60 * 1000, // 30 days
  admin: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/** Seconds, for the `Max-Age` cookie attribute. */
export function sessionMaxAgeSeconds(scope: SessionScope): number {
  return SESSION_TTL_MS[scope] / 1000;
}

/**
 * Refresh the cookie only once a session is over a day old. Writing to SQLite
 * on every request would turn each read-only query into a write, and a day's
 * granularity is invisible against a 7-day window.
 */
const SLIDING_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

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
  scope: SessionScope;
  /** True when this read slid the expiry forward, so the caller re-sets the cookie. */
  refreshed?: boolean;
}

/** Create a session and return the raw token to set as a cookie. */
export function createPlexSession(userId: number, username: string, scope: SessionScope): string {
  const raw = randomBytes(32).toString("hex");
  const now = Date.now();
  db.insert(plexSessions)
    .values({ id: hashToken(raw), userId, username, scope, createdAt: now, expiresAt: now + SESSION_TTL_MS[scope] })
    .run();
  return raw;
}

/**
 * Resolve a raw cookie token to its session, or undefined if it's missing,
 * expired, or belongs to a different scope. A portal cookie presented to an
 * admin route resolves to nothing at all, not to a downgraded session.
 */
export function getPlexSession(raw: string | undefined, scope: SessionScope): PlexSession | undefined {
  if (!raw) return undefined;
  const row = db
    .select()
    .from(plexSessions)
    .where(and(eq(plexSessions.id, hashToken(raw)), eq(plexSessions.scope, scope)))
    .get();
  if (!row) return undefined;
  const now = Date.now();
  if (row.expiresAt < now) {
    db.delete(plexSessions).where(eq(plexSessions.id, row.id)).run();
    return undefined;
  }

  // Sliding expiry: an admin who uses the app daily never gets logged out,
  // while an abandoned session still dies on schedule.
  const ttl = SESSION_TTL_MS[row.scope as SessionScope] ?? SESSION_TTL_MS.portal;
  const refreshed = now + ttl - row.expiresAt > SLIDING_REFRESH_AFTER_MS;
  if (refreshed) {
    db.update(plexSessions)
      .set({ expiresAt: now + ttl })
      .where(eq(plexSessions.id, row.id))
      .run();
  }

  return { userId: row.userId, username: row.username, scope: row.scope as SessionScope, refreshed };
}

export function deletePlexSession(raw: string | undefined): void {
  if (!raw) return;
  db.delete(plexSessions)
    .where(eq(plexSessions.id, hashToken(raw)))
    .run();
}

/** Drop every session in a scope — used when auth config changes invalidate them. */
export function deletePlexSessionsInScope(scope: SessionScope): void {
  db.delete(plexSessions).where(eq(plexSessions.scope, scope)).run();
}

export function prunePlexSessions(): void {
  db.delete(plexSessions).where(lt(plexSessions.expiresAt, Date.now())).run();
}

/** True if this Plex user id is a known user of this server (synced sharings). */
export function plexUserExists(userId: number): boolean {
  return !!db.select({ userId: plexUsers.userId }).from(plexUsers).where(eq(plexUsers.userId, userId)).get();
}
