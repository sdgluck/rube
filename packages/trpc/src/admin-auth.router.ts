/**
 * Admin authentication: the Sign-in-with-Plex handshake for the admin app,
 * plus the context factory that turns a cookie into a session.
 *
 * This is the portal's flow pointed at the admin app with a stricter gate —
 * the portal admits any shared user, this admits only the server owner (and
 * anyone the owner allow-listed).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  adminAuthConfigured,
  adminAuthRequired,
  authDisabledByEnv,
  cachedOwner,
  createPlexSession,
  createLogger,
  deletePlexSession,
  deletePlexSessionsInScope,
  ensurePlexClientId,
  getConfig,
  getPlexSession,
  isAdminAccount,
  OwnerUnresolvedError,
  resolveOwner,
  setConfig,
} from "@tinkerbell/core";
import { buildPlexAuthUrl, checkPlexPin, createPlexPin, getPlexAccount } from "@tinkerbell/plex";
import { emitEvent } from "@tinkerbell/domain.events";
import { t, publicProcedure, procedure, type AdminContext } from "./_base.ts";
import { COOKIE_NAMES, clearSessionCookie, isSecureRequest, parseCookie, setSessionCookie } from "./cookies.ts";

const log = createLogger("auth");

export function createAdminContext(opts: { req: Request; resHeaders: Headers; ip?: string }): AdminContext {
  const secure = isSecureRequest(opts.req);
  const rawToken = parseCookie(opts.req.headers.get("cookie") ?? "", COOKIE_NAMES.admin);
  const session = getPlexSession(rawToken, "admin");

  // Sliding expiry only moves the DB row; the browser's copy carries its own
  // Max-Age, so it has to be re-sent or the cookie would still expire on the
  // original schedule.
  if (session?.refreshed && rawToken) {
    setSessionCookie(opts.resHeaders, rawToken, { scope: "admin", secure });
  }

  // A session that was valid when it was issued but whose account has since
  // lost admin rights (removed from the allow-list, token rotated to a
  // different owner) must stop working immediately, not at expiry.
  const authorised = session && isAdminAccount(session.userId) ? session : undefined;

  return {
    session: authorised && { userId: authorised.userId, username: authorised.username },
    rawToken,
    resHeaders: opts.resHeaders,
    secure,
    ip: opts.ip ?? "unknown",
    authRequired: adminAuthRequired(),
  };
}

// ─── Rate limiting ────────────────────────────────────────────────────────
// `auth.poll` talks to plex.tv on every call, so an unauthenticated caller
// could otherwise use this server to hammer someone else's API. An in-memory
// counter is enough: it resets on restart, which is fine for a home server,
// and it needs no storage.

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const attempts = new Map<string, { count: number; resetAt: number }>();

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

export const adminAuthRouter = t.router({
  /**
   * Everything the SPA needs to pick a screen, before it can call anything
   * else. Public by necessity — it's the answer to "do I need to log in?".
   * It deliberately reveals nothing beyond that and the signed-in identity.
   */
  status: publicProcedure.query(({ ctx }) => {
    const owner = cachedOwner();
    return {
      configured: adminAuthConfigured(),
      required: ctx.authRequired,
      disabledByEnv: authDisabledByEnv(),
      signedIn: !!ctx.session,
      username: ctx.session?.username,
      ownerUsername: owner?.username,
      ownerResolved: !!owner,
      allowedUserIds: getConfig("admin_allowed_user_ids") ?? [],
    };
  }),

  start: publicProcedure
    .input(z.object({ forwardUrl: z.string().url().optional() }))
    .mutation(async ({ ctx, input }) => {
      rateLimit(ctx.ip);
      // Fail before sending anyone to plex.tv if we couldn't tell who the
      // owner is — otherwise they'd complete the whole dance only to be
      // refused at the end.
      await requireOwner();
      const clientId = ensurePlexClientId();
      const pin = await createPlexPin(clientId);
      return {
        id: pin.id,
        authUrl: buildPlexAuthUrl({ clientId, code: pin.code, forwardUrl: input.forwardUrl ?? "" }),
      };
    }),

  poll: publicProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx.ip);
    const clientId = ensurePlexClientId();
    const token = await checkPlexPin(input.id, clientId);
    if (!token) return { status: "pending" as const };

    const account = await getPlexAccount(token, clientId);
    const owner = await requireOwner();

    if (!isAdminAccount(account.id)) {
      // A real, authenticated Plex account that simply isn't allowed here:
      // FORBIDDEN, not UNAUTHORIZED, because signing in again won't help.
      log.warn("admin sign-in refused", { userId: account.id, username: account.username, ip: ctx.ip });
      emitEvent("auth.denied", `Admin sign-in refused for Plex user ${account.username}`, {
        userId: account.id,
        ip: ctx.ip,
      });
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${account.username} isn't the owner of this Plex server (${owner.username}).`,
      });
    }

    const raw = createPlexSession(account.id, account.username, "admin");
    setSessionCookie(ctx.resHeaders, raw, { scope: "admin", secure: ctx.secure });
    emitEvent("auth.signin", `${account.username} signed in`, { userId: account.id });
    return { status: "ok" as const, username: account.username };
  }),

  logout: publicProcedure.mutation(({ ctx }) => {
    deletePlexSession(ctx.rawToken);
    clearSessionCookie(ctx.resHeaders, { scope: "admin", secure: ctx.secure });
    return { ok: true };
  }),

  /**
   * Turn auth on. Public, and it has to be: before auth is enabled there is
   * no session to authenticate with, so requiring one would make the feature
   * impossible to adopt. Once enabled this is a no-op for anyone who isn't
   * already signed in, because `disable` below is gated.
   */
  enable: publicProcedure.mutation(async ({ ctx }) => {
    // …but once it *is* on, an anonymous caller must not be able to re-run it:
    // it makes a plex.tv call and drops every live admin session, which would
    // be a free way to log the owner out repeatedly.
    if (ctx.authRequired && !ctx.session) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
    }
    const owner = await requireOwner({ force: true });
    // Any session predating the switch was minted while nothing was checked.
    deletePlexSessionsInScope("admin");
    setConfig("admin_auth_enabled", true);
    emitEvent("auth.enabled", `Admin authentication enabled — sign in as ${owner.username}`);
    log.info("admin authentication enabled", { owner: owner.username });
    return { ok: true, ownerUsername: owner.username };
  }),

  /** Turn auth off. Gated: only a signed-in admin may open the door. */
  disable: procedure.mutation(({ ctx }) => {
    setConfig("admin_auth_enabled", false);
    emitEvent("auth.disabled", `Admin authentication disabled by ${ctx.session?.username ?? "an admin"}`);
    log.warn("admin authentication disabled", { by: ctx.session?.username });
    return { ok: true };
  }),

  /** Grant or revoke admin access for additional Plex accounts. */
  setAllowedUserIds: procedure.input(z.object({ userIds: z.array(z.number().int()) })).mutation(({ input }) => {
    setConfig("admin_allowed_user_ids", input.userIds);
    return { ok: true };
  }),
});

/**
 * Resolve the owner, mapping the failure to a 412 the UI can explain. Auth
 * without a known owner would admit whoever signed in first, so this refuses
 * rather than degrades.
 */
async function requireOwner(opts: { force?: boolean } = {}) {
  try {
    return await resolveOwner(opts);
  } catch (err) {
    if (err instanceof OwnerUnresolvedError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    }
    throw err;
  }
}
