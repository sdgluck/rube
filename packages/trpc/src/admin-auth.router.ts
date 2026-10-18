import { perDeps } from "@tinkerbell/container";
import type { TrpcDeps } from "./deps.ts";
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
import { authDisabledByEnv, createLogger, OwnerUnresolvedError, parseBearerToken } from "@tinkerbell/core";
import { buildPlexAuthUrl, checkPlexPin, createPlexPin, getPlexAccount } from "@tinkerbell/plex";

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
import { isBrowserRequest, refuseBrowser } from "./browser-request.ts";
import { exchangeAccount } from "./exchange-account.ts";
import { createHandshakes } from "./handshake.ts";
import { serverInfo } from "./server-info.ts";
import { NativeAdmin } from "@tinkerbell/contracts/native-api";

/**
 * Which client is signing in. A browser gets the handshake and the session as
 * HttpOnly cookies; a native app (which reaches this server cross-origin, where
 * no cookie survives) gets both in the response body and keeps them itself.
 */
const startInput = z.object({ client: z.enum(["browser", "native"]) }).optional();
const pollInput = z.object({ handshake: z.string().max(128) }).optional();
/** A plex.tv user token the native app obtained by running the PIN flow itself. */
const exchangeInput = z.object({ plexToken: z.string().min(1).max(256) });

const log = createLogger("auth");

export const createAdminAuthRouter = perDeps(function createAdminAuthRouter(deps: TrpcDeps) {
  const { createHandshake, rateLimit, readHandshake, spendHandshake } = createHandshakes(deps);
  const { adminAuth, config, events, sessions } = deps;
  const { adminAuthConfigured, adminAuthRequired, cachedOwner, isAdminAccount, resolveOwner } = adminAuth;
  const { createPlexSession, deletePlexSession, deletePlexSessionsInScope, ensureAdminPlexClientId, getPlexSession } =
    sessions;
  const { getConfig, setConfig } = config;
  const { emitEvent } = events;

  function createAdminContext(opts: { req: Request; resHeaders: Headers; ip?: string }): AdminContext {
    const secure = isSecureRequest(opts.req);
    const cookies = opts.req.headers.get("cookie") ?? "";
    const cookieToken = parseCookie(cookies, COOKIE_NAMES.admin);
    // The native app's session arrives as a bearer token instead. The cookie
    // wins when both are present, so a browser can't be steered onto some other
    // session by a header it didn't choose.
    const rawToken = cookieToken ?? parseBearerToken(opts.req.headers.get("authorization"));
    const session = getPlexSession(rawToken, "admin");

    // Sliding expiry only moves the DB row; the browser's copy carries its own
    // Max-Age, so it has to be re-sent or the cookie would still expire on the
    // original schedule. A bearer token has no copy to refresh.
    if (session?.refreshed && cookieToken) {
      setSessionCookie(opts.resHeaders, cookieToken, { scope: "admin", secure });
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
      // One scope per request, disposed by the HTTP layer when the response is
      // sent. Nothing is registered `scoped` yet; having the boundary here is
      // what makes adding one later safe rather than a leak.
      scope: deps.scope.createScope("request"),
      session: authorised && { userId: authorised.userId, username: authorised.username },
      rawToken,
      resHeaders: opts.resHeaders,
      secure,
      handshakeNonce: parseCookie(cookies, HANDSHAKE_COOKIES.admin),
      origin: `${secure ? "https" : "http"}://${host}`,
      ip: opts.ip ?? "unknown",
      authRequired: adminAuthRequired(),
      fromBrowser: isBrowserRequest(opts.req),
    };
  }

  const adminAuthRouter = t.router({
    /**
     * Everything the SPA needs to pick a screen, before it can call anything
     * else. Public by necessity — it's the answer to "do I need to log in?".
     * It deliberately reveals nothing beyond that and the signed-in identity.
     */
    status: publicProcedure.output(NativeAdmin.AuthStatusOutput).query(({ ctx }) => {
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
    start: publicProcedure.input(startInput).mutation(async ({ ctx, input }) => {
      rateLimit(ctx.ip);
      // Fail before sending anyone to plex.tv if we couldn't tell who the
      // owner is — otherwise they'd complete the whole dance only to be
      // refused at the end.
      await requireOwner();
      const clientId = ensureAdminPlexClientId();
      const pin = await createPlexPin(clientId);
      if (input?.client === "native") {
        // No `forwardUrl`: the app shows plex.tv in a sheet it closes itself.
        const handshake = createHandshake("admin", pin.id, "native");
        return { authUrl: buildPlexAuthUrl({ clientId, code: pin.code }), handshake };
      }
      const nonce = createHandshake("admin", pin.id);
      setHandshakeCookie(ctx.resHeaders, nonce, { scope: "admin", secure: ctx.secure });
      return {
        // `forwardUrl` is this server's own origin, derived from the request.
        // It used to be caller-supplied, which let anyone choose where the
        // browser landed after approving — the last step of a convincing phish.
        authUrl: buildPlexAuthUrl({ clientId, code: pin.code, forwardUrl: ctx.origin }),
      };
    }),

    poll: publicProcedure.input(pollInput).mutation(async ({ ctx, input }) => {
      rateLimit(ctx.ip);
      const native = input?.handshake !== undefined;
      const nonce = native ? input.handshake : ctx.handshakeNonce;
      const pinId = readHandshake("admin", nonce, native ? "native" : "browser");
      // No cookie, or one this process doesn't recognise: there is nothing to
      // finish. The client starts over rather than being told anything about
      // which PINs exist.
      if (pinId === undefined) {
        if (!native) clearHandshakeCookie(ctx.resHeaders, { scope: "admin", secure: ctx.secure });
        return { status: "expired" as const };
      }

      const clientId = ensureAdminPlexClientId();
      const token = await checkPlexPin(pinId, clientId);
      if (!token) return { status: "pending" as const };

      // Redeemed — one way or the other this handshake is spent.
      spendHandshake("admin", nonce);
      if (!native) clearHandshakeCookie(ctx.resHeaders, { scope: "admin", secure: ctx.secure });

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
      // Recorded with the address that completed the handshake so an unexpected
      // sign-in is visible in the activity feed.
      emitEvent("auth.signin", `${account.username} signed in${native ? " in the app" : ""}`, {
        userId: account.id,
        ip: ctx.ip,
      });
      // Only a handshake the native app began hands the token back in the body —
      // a browser's session stays in an HttpOnly cookie, out of reach of script.
      if (native) return { status: "ok" as const, username: account.username, token: raw };
      setSessionCookie(ctx.resHeaders, raw, { scope: "admin", secure: ctx.secure });
      return { status: "ok" as const, username: account.username };
    }),

    /**
     * The native app's sign-in. The app runs the plex.tv PIN flow itself — so
     * one approval signs it in to the portal and to this server, each of which
     * checks the result independently and shares nothing with the other — and
     * hands over the Plex token it got. This server asks plex.tv who that is,
     * applies the same admin check as `poll`, and answers with a session of its
     * own in the body.
     *
     * The Plex token is used for that one lookup and never logged or stored.
     * A browser can't call this: a page that got hold of a Plex token must not
     * be able to turn it into an admin session readable from script.
     */
    exchange: publicProcedure
      .input(exchangeInput)
      .output(NativeAdmin.AuthExchangeOutput)
      .mutation(async ({ ctx, input }) => {
        refuseBrowser(ctx.fromBrowser);
        rateLimit(ctx.ip);
        // Nothing to sign in to — the app says so instead of holding a session
        // that proves nothing.
        if (!ctx.authRequired) return { status: "open" as const };

        await requireOwner();
        const account = await exchangeAccount(input.plexToken, ensureAdminPlexClientId());
        if (!isAdminAccount(account.id)) {
          log.warn("admin sign-in refused", { userId: account.id, username: account.username, ip: ctx.ip });
          emitEvent("auth.denied", `Admin sign-in refused for Plex user ${account.username}`, {
            userId: account.id,
            ip: ctx.ip,
          });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${account.username} isn't allowed to administer this server.`,
          });
        }

        const token = createPlexSession(account.id, account.username, "admin");
        emitEvent("auth.signin", `${account.username} signed in in the app`, { userId: account.id, ip: ctx.ip });
        return { status: "ok" as const, username: account.username, token };
      }),

    logout: publicProcedure
      .input(z.object({ mediaToken: z.string().max(128).optional() }).optional())
      .output(NativeAdmin.AuthLogoutOutput)
      .mutation(({ ctx, input }) => {
        deletePlexSession(ctx.rawToken);
        // The app's media token outlives nothing it was minted from.
        if (input?.mediaToken && getPlexSession(input.mediaToken, "admin-media")) deletePlexSession(input.mediaToken);
        clearSessionCookie(ctx.resHeaders, { scope: "admin", secure: ctx.secure });
        return { ok: true };
      }),

    /**
     * "Is this a Tinkerbell admin server, and which release?" — the native
     * app's server picker asks before anything else. See `server-info.ts`.
     */
    server: publicProcedure.output(NativeAdmin.AuthServerOutput).query(() => ({
      ...serverInfo("tinkerbell-admin"),
      // Whether the app needs to sign in at all — with auth off it shows a
      // standing "admin is open" warning instead of a sign-in button.
      authRequired: adminAuthRequired(),
      // The admin may name the portal (it is the public half); the portal
      // never names the admin, which is why this is only on this router.
      portalUrl: getConfig("user_app_public_url") || null,
    })),

    /**
     * A short-lived credential for the native app's images and video, which
     * an `<img>` can't attach a header to. Accepted only as `?access_token=` on
     * the plain GET routes (`apps/server/src/auth.ts`), never by tRPC — so a
     * leaked one shows posters for a day and does nothing else.
     *
     * Null with auth off: those routes are open then, and there is no session
     * to mint one from.
     */
    mediaToken: procedure.mutation(({ ctx }) => {
      if (!ctx.session) return { token: null };
      return { token: createPlexSession(ctx.session.userId, ctx.session.username, "admin-media") };
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
      deletePlexSessionsInScope("admin-media");
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

  return { createAdminContext, adminAuthRouter };
});
