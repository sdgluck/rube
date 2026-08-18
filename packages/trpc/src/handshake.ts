import type { TrpcDeps } from "./deps.ts";
import { perDeps } from "@tinkerbell/container";
/**
 * The Sign-in-with-Plex handshake store, and the rate limit that guards it.
 *
 * A PIN id is not a secret: plex.tv hands its auth token to anyone who asks
 * with the client identifier that created it, and the ids it issues are
 * sequential. So the id never leaves this process. `create` keeps it here
 * against an unguessable nonce and the caller gives the browser only the
 * nonce, in an HttpOnly cookie; the poll step looks the id back up from that
 * cookie and accepts no id from the caller at all.
 *
 * Shared by both apps because both flows have the same problem. The admin flow
 * solved it first; the portal was still redeeming a caller-supplied id, which
 * let anyone polling around the current id range collect the session of a user
 * who happened to be approving one at the time.
 *
 * Nonces are namespaced by scope, so a nonce minted by one app can never
 * redeem the other's PIN — the same separation `sessions.ts` requires of the
 * session cookies themselves.
 *
 * In memory on purpose: a handshake is worthless after 15 minutes, and a
 * restart mid-sign-in costs one click to retry.
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { SessionScope } from "@tinkerbell/core";
import { HANDSHAKE_MAX_AGE } from "./cookies.ts";

const HANDSHAKE_TTL_MS = HANDSHAKE_MAX_AGE * 1000;

function keyFor(scope: SessionScope, nonce: string): string {
  return `${scope}:${nonce}`;
}

// ─── Rate limiting ────────────────────────────────────────────────────────
// `poll` talks to plex.tv on every call, so an unauthenticated caller could
// otherwise use this server to hammer someone else's API. An in-memory counter
// is enough: it resets on restart, which is fine for a home server, and it
// needs no storage.

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

export const createHandshakes = perDeps(function createHandshakes(_deps: TrpcDeps) {
  const handshakes = new Map<string, { pinId: number; expiresAt: number }>();
  const attempts = new Map<string, { count: number; resetAt: number }>();

  function createHandshake(scope: SessionScope, pinId: number): string {
    const now = Date.now();
    for (const [key, value] of handshakes) if (value.expiresAt < now) handshakes.delete(key);
    const nonce = randomBytes(32).toString("hex");
    handshakes.set(keyFor(scope, nonce), { pinId, expiresAt: now + HANDSHAKE_TTL_MS });
    return nonce;
  }

  /** Resolve a nonce to its PIN id, or undefined if unknown, expired or foreign. */
  function readHandshake(scope: SessionScope, nonce: string | undefined): number | undefined {
    if (!nonce) return undefined;
    const key = keyFor(scope, nonce);
    const entry = handshakes.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      handshakes.delete(key);
      return undefined;
    }
    return entry.pinId;
  }

  /** Redeemed, refused or abandoned — either way the handshake is spent. */
  function spendHandshake(scope: SessionScope, nonce: string | undefined): void {
    if (nonce) handshakes.delete(keyFor(scope, nonce));
  }

  /** Test seam: drop everything, so one test's nonces can't answer another's. */
  function resetHandshakes(): void {
    handshakes.clear();
  }

  function rateLimit(ip: string): void {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      // Opportunistic sweep — without it a rotating source address grows the
      // map without bound.
      if (attempts.size > 1000) {
        for (const [key, value] of attempts) if (value.resetAt < now) attempts.delete(key);
      }
      return;
    }
    entry.count++;
    if (entry.count > RATE_MAX) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many sign-in attempts. Wait a minute." });
    }
  }

  /** Test seam, as above. */
  function resetRateLimits(): void {
    attempts.clear();
  }

  return { createHandshake, readHandshake, spendHandshake, resetHandshakes, rateLimit, resetRateLimits };
});
