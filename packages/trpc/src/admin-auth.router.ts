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
  ensureAdminPlexClientId,
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
import {
  COOKIE_NAMES,
  HANDSHAKE_COOKIES,
  clearHandshakeCookie,
  clearSessionCookie,
  isSecureRequest,
  parseCookie,
  setHandshakeCookie,
  setSessionCookie,
} from "./cookies.ts";
import { createHandshake, rateLimit, readHandshake, spendHandshake } from "./handshake.ts";

const log = createLogger("auth");

export function createAdminContext(opts: { req: Request; resHeaders: Headers; ip?: string }): AdminContext {
  const secure = isSecureRequest(opts.req);
  const cookies = opts.req.headers.get("cookie") ?? "";
  const rawToken = parseCookie(cookies, COOKIE_NAMES.admin);
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

  // Behind a reverse proxy the Host the browser used is the forwarded one;
  // the socket's Host is the internal address and would send the user back to
  // somewhere they can't reach.
  const forwardedHost = opts.req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || new URL(opts.req.url).host;

  return {
    session: authorised && { userId: authorised.userId, username: authorised.username },
    rawToken,
    resHeaders: opts.resHeaders,
    secure,
    handshakeNonce: parseCookie(cookies, HANDSHAKE_COOKIES.admin),
    origin: `${secure ? "https" : "http"}://${host}`,
    ip: opts.ip ?? "unknown",
    authRequired: adminAuthRequired(),
  };
}

export const adminAuthRouter = t.router({
  /**
   * Everything the SPA needs to pick a screen, before it can call anything
   * else. Public by necessity — it's the answer to "do I need to log in?".
   * It deliberately reveals nothing beyond that and the signed-in identity.
   */
  status: publicProcedure.query(({ ctx }) => {
    const owner = cachedOwner();
    const configured = adminAuthConfigured();
    // Who the owner is, and who else may administer, are answers for people
    // who are already in — or for the pre-adoption case, where the setup copy
    // names the account that's about to become the only way in and there is
    // no gate to leak past anyway.
    const maySeeIdentities = !!ctx.session || !configured;
    return {
      configured,
      required: ctx.authRequired,
      disabledByEnv: authDisabledByEnv(),
      signedIn: !!ctx.session,
      username: ctx.session?.username,
      // Always present: the SPA needs it to choose a screen.
      ownerResolved: !!owner,
      ownerUsername: maySeeIdentities ? owner?.username : undefined,
      allowedUserIds: maySeeIdentities ? (getConfig("admin_allowed_user_ids") ?? []) : undefined,
    };
  }),

  /**
   * Begin a sign-in. Returns only the plex.tv URL to send the browser to —
   * the PIN id stays here, bound to a nonce in an HttpOnly cookie, so the
   * handshake can only be completed by the browser that began it.
   */
  start: publicProcedure.mutation(async ({ ctx }) => {
    rateLimit(ctx.ip);
    // Fail before sending anyone to plex.tv if we couldn't tell who the
    // owner is — otherwise they'd complete the whole dance only to be
    // refused at the end.
    await requireOwner();
    const clientId = ensureAdminPlexClientId();
    const pin = await createPlexPin(clientId);
    const nonce = createHandshake("admin", pin.id);
    setHandshakeCookie(ctx.resHeaders, nonce, { scope: "admin", secure: ctx.secure });
    return {
      // `forwardUrl` is this server's own origin, derived from the request.
      // It used to be caller-supplied, which let anyone choose where the
      // browser landed after approving — the last step of a convincing phish.
      authUrl: buildPlexAuthUrl({ clientId, code: pin.code, forwardUrl: ctx.origin }),
    };
  }),

  poll: publicProcedure.mutation(async ({ ctx }) => {
    rateLimit(ctx.ip);
    const pinId = readHandshake("admin", ctx.handshakeNonce);
    // No cookie, or one this process doesn't recognise: there is nothing to
    // finish. The client starts over rather than being told anything about
    // which PINs exist.
    if (pinId === undefined) {
      clearHandshakeCookie(ctx.resHeaders, { scope: "admin", secure: ctx.secure });
      return { status: "expired" as const };
    }

    const clientId = ensureAdminPlexClientId();
    const token = await checkPlexPin(pinId, clientId);
    if (!token) return { status: "pending" as const };

    // Redeemed — one way or the other this handshake is spent.
    spendHandshake("admin", ctx.handshakeNonce);
    clearHandshakeCookie(ctx.resHeaders, { scope: "admin", secure: ctx.secure });

    const account = await getPlexAccount(token, clientId);
    await requireOwner();

    if (!isAdminAccount(account.id)) {
      // A real, authenticated Plex account that simply isn't allowed here:
      // FORBIDDEN, not UNAUTHORIZED, because signing in again won't help.
      log.warn("admin sign-in refused", { userId: account.id, username: account.username, ip: ctx.ip });
      emitEvent("auth.denied", `Admin sign-in refused for Plex user ${account.username}`, {
        userId: account.id,
        ip: ctx.ip,
      });
      // Deliberately doesn't name the owner: the caller has proved only that
      // they hold some Plex account.
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${account.username} isn't allowed to administer this server.`,
      });
    }

    const raw = createPlexSession(account.id, account.username, "admin");
    setSessionCookie(ctx.resHeaders, raw, { scope: "admin", secure: ctx.secure });
    // Recorded with the address that completed the handshake so an unexpected
    // sign-in is visible in the activity feed.
    emitEvent("auth.signin", `${account.username} signed in`, { userId: account.id, ip: ctx.ip });
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
    // Everything the pre-auth window could have written is reset here, because
    // until this moment the API answered to anyone who could reach the port.
    // Sessions were minted while nothing was checked…
    deletePlexSessionsInScope("admin");
    // …and the allow-list is a standing grant of admin to arbitrary Plex
    // accounts, so it must not survive the switch either. Adding a second
    // admin afterwards is one call for the signed-in owner; inheriting one
    // from before the door was locked is a backdoor.
    setConfig("admin_allowed_user_ids", []);
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
