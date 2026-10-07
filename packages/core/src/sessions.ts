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
import { token } from "@tinkerbell/container";
import { plexSessions, plexUsers, type Db } from "@tinkerbell/db";
import type { ConfigStore } from "./config.ts";

export type SessionScope = "portal" | "admin";

/**
 * Every kind of token the sessions table holds. `SessionScope` is the subset a
 * person signs in to (and that has a cookie); `admin-media` is minted *from*
 * an admin session for the native app's `<img>`/`<video>` requests, which can't
 * carry an `Authorization` header. It lives in the URL, so it is short-lived
 * and only the GET routes accept it — the session token itself never appears
 * in a URL, a proxy log or a `Referer`.
 */
export type TokenScope = SessionScope | "admin-media";

/**
 * Portal sessions are long-lived because the portal is a low-privilege,
 * user-facing page people return to occasionally. An admin session can delete
 * every collection on the server, so it expires far sooner — kept alive by
 * sliding refresh for as long as the admin is actually using the app.
 */
const SESSION_TTL_MS: Record<TokenScope, number> = {
  portal: 30 * 24 * 60 * 60 * 1000, // 30 days
  admin: 7 * 24 * 60 * 60 * 1000, // 7 days
  "admin-media": 24 * 60 * 60 * 1000, // 1 day; the app mints a fresh one on launch
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

/** What `createPlexSession` mints: 32 random bytes, hex. */
const RAW_TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * The session token from an `Authorization: Bearer …` header — how the native
 * apps authenticate, since a cookie set by a server on another origin is never
 * sent back from `capacitor://`.
 *
 * Only the shape a session token has is accepted. That is what keeps an agent
 * API key (`tbk_…`) from being mistaken for one: keys are read-only and live on
 * `/mcp` and `/api/v1`, and a key that reached a session lookup would be a
 * second, unguarded way in.
 */
export function parseBearerToken(header: string | null | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return match && RAW_TOKEN_RE.test(match[1]) ? match[1] : undefined;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface PlexSession {
  userId: number;
  username: string;
  scope: TokenScope;
  /** True when this read slid the expiry forward, so the caller re-sets the cookie. */
  refreshed?: boolean;
}

export interface SessionsDeps {
  db: Db;
  config: ConfigStore;
}

export function createSessions(deps: SessionsDeps) {
  const { db } = deps;
  const { getConfig, setConfig } = deps.config;

  /** Return the configured Plex client identifier, generating one on first use. */
  function ensurePlexClientId(): string {
    const existing = getConfig("global_plex_client_id");
    if (existing) return existing;
    const id = randomUUID();
    setConfig("global_plex_client_id", id);
    return id;
  }

  /**
   * The admin flow's own client identifier, deliberately NOT the portal's.
   *
   * plex.tv will hand a PIN's auth token to anyone who asks with the client
   * identifier that created it. Sharing one identifier between the two flows
   * therefore means a PIN minted by the public portal is redeemable at the admin
   * endpoint — a portal login could be converted into an admin session. Separate
   * identifiers make that impossible at the plex.tv layer rather than relying on
   * our own bookkeeping.
   */
  function ensureAdminPlexClientId(): string {
    const existing = getConfig("admin_plex_client_id");
    if (existing) return existing;
    const id = randomUUID();
    setConfig("admin_plex_client_id", id);
    return id;
  }

  /** Create a session and return the raw token to set as a cookie. */
  function createPlexSession(userId: number, username: string, scope: TokenScope): string {
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
  function getPlexSession(raw: string | undefined, scope: TokenScope): PlexSession | undefined {
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
    const ttl = SESSION_TTL_MS[row.scope as TokenScope] ?? SESSION_TTL_MS.portal;
    const refreshed = now + ttl - row.expiresAt > SLIDING_REFRESH_AFTER_MS;
    if (refreshed) {
      db.update(plexSessions)
        .set({ expiresAt: now + ttl })
        .where(eq(plexSessions.id, row.id))
        .run();
    }

    return { userId: row.userId, username: row.username, scope: row.scope as TokenScope, refreshed };
  }

  function deletePlexSession(raw: string | undefined): void {
    if (!raw) return;
    db.delete(plexSessions)
      .where(eq(plexSessions.id, hashToken(raw)))
      .run();
  }

  /** Drop every session in a scope — used when auth config changes invalidate them. */
  function deletePlexSessionsInScope(scope: TokenScope): void {
    db.delete(plexSessions).where(eq(plexSessions.scope, scope)).run();
  }

  function prunePlexSessions(): void {
    db.delete(plexSessions).where(lt(plexSessions.expiresAt, Date.now())).run();
  }

  /** True if this Plex user id is a known user of this server (synced sharings). */
  function plexUserExists(userId: number): boolean {
    return !!db.select({ userId: plexUsers.userId }).from(plexUsers).where(eq(plexUsers.userId, userId)).get();
  }

  return {
    ensurePlexClientId,
    ensureAdminPlexClientId,
    createPlexSession,
    getPlexSession,
    deletePlexSession,
    deletePlexSessionsInScope,
    prunePlexSessions,
    plexUserExists,
  };
}

export type Sessions = ReturnType<typeof createSessions>;

export const SessionsToken = token<Sessions>("sessions");
