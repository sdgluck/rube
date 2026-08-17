/**
 * The user-facing portal API. Served on a SEPARATE port from the admin
 * `appRouter`, behind Sign-in-with-Plex sessions. Public procedures cover the
 * auth handshake; everything else requires a valid session and is scoped to
 * the authenticated user (they can only ever read/write their own prefs).
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ensurePlexClientId,
  getConfig,
  createPlexSession,
  getPlexSession,
  deletePlexSession,
  plexUserExists,
  getUserPreferences,
  setUserPreferences,
  userPreferencesSchema,
} from "@tinkerbell/core";
// From _base, not core, so an unconfigured Plex answers 412 here too.
import { getPlexClient } from "./_base.ts";
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
import { createPlexPin, buildPlexAuthUrl, checkPlexPin, getPlexAccount } from "@tinkerbell/plex";
import { searchMediaTitles } from "@tinkerbell/domain.media";
import { getCollectionsForUser } from "@tinkerbell/domain.collections";
import { keepVotesForUser, leavingSoon, recordKeepVote, removeKeepVote } from "@tinkerbell/domain.cleanup";
import { userTotals } from "@tinkerbell/domain.playback";

export interface PortalContext {
  session?: { userId: number; username: string };
  rawToken?: string;
  resHeaders: Headers;
  /** Whether the request arrived over HTTPS, so the cookie can be `Secure`. */
  secure: boolean;
  /** The in-flight sign-in handshake, if this browser began one. */
  handshakeNonce?: string;
  /** Where the browser thinks it is, for the plex.tv return trip. */
  origin: string;
  ip: string;
}

export function createPortalContext(opts: { req: Request; resHeaders: Headers; ip?: string }): PortalContext {
  const secure = isSecureRequest(opts.req);
  const cookies = opts.req.headers.get("cookie") ?? "";
  const rawToken = parseCookie(cookies, COOKIE_NAMES.portal);
  const session = getPlexSession(rawToken, "portal");

  // Sliding expiry only moves the DB row; the browser's copy carries its own
  // Max-Age, so it has to be re-sent or a portal user who visits every day
  // would still be logged out on the original schedule.
  if (session?.refreshed && rawToken) {
    setSessionCookie(opts.resHeaders, rawToken, { scope: "portal", secure });
  }

  // A session that was valid when it was issued but whose account has since
  // stopped being a user of this server must stop working immediately, not at
  // expiry — the admin flow re-checks `isAdminAccount` on every request for
  // exactly this reason, and unsharing a library is the portal's equivalent.
  const authorised = session && plexUserExists(session.userId) ? session : undefined;

  // Behind a reverse proxy the Host the browser used is the forwarded one; the
  // socket's Host is the internal address and would send the user somewhere
  // they can't reach.
  const forwardedHost = opts.req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || new URL(opts.req.url).host;

  return {
    session: authorised && { userId: authorised.userId, username: authorised.username },
    rawToken,
    resHeaders: opts.resHeaders,
    secure,
    handshakeNonce: parseCookie(cookies, HANDSHAKE_COOKIES.portal),
    origin: `${secure ? "https" : "http"}://${host}`,
    ip: opts.ip ?? "unknown",
  };
}

const tp = initTRPC.context<PortalContext>().create();
const publicProcedure = tp.procedure;
const userProcedure = tp.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in with Plex first." });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const portalRouter = tp.router({
  // Whether personalization is live — the portal shows a banner when it isn't.
  personalizationStatus: publicProcedure.query(() => {
    return getConfig("global_personalized_sharing")?.status ?? "disabled";
  }),

  // Admin-customized header/background. Public so the login screen is branded.
  branding: publicProcedure.query(() => getConfig("portal_branding") ?? {}),

  auth: tp.router({
    /**
     * Begin a sign-in. Returns only the plex.tv URL to send the browser to.
     *
     * Neither the PIN id nor the return address is the caller's to choose. The
     * id stays in this process behind a nonce in an HttpOnly cookie, because
     * plex.tv will hand a PIN's token to anyone who asks with the client id
     * that minted it and the ids it issues are sequential — polling around the
     * live range while somebody approves theirs would otherwise hand over
     * their session. And `forwardUrl` used to be caller-supplied, which let
     * anyone choose where the browser landed after approving: a genuine
     * app.plex.tv link that finishes on their page.
     */
    start: publicProcedure.mutation(async ({ ctx }) => {
      rateLimit(ctx.ip);
      const clientId = ensurePlexClientId();
      const pin = await createPlexPin(clientId);
      const nonce = createHandshake("portal", pin.id);
      setHandshakeCookie(ctx.resHeaders, nonce, { scope: "portal", secure: ctx.secure });
      // The admin-configured public URL wins when it is set — behind a proxy
      // it is the address that actually reaches the portal — and the request's
      // own origin is the fallback. Both are the server's answer, not the
      // caller's.
      const forwardUrl = getConfig("user_app_public_url") || ctx.origin;
      return { authUrl: buildPlexAuthUrl({ clientId, code: pin.code, forwardUrl }) };
    }),

    poll: publicProcedure.mutation(async ({ ctx }) => {
      rateLimit(ctx.ip);
      const pinId = readHandshake("portal", ctx.handshakeNonce);
      // No cookie, or one this process doesn't recognise: nothing to finish.
      if (pinId === undefined) {
        clearHandshakeCookie(ctx.resHeaders, { scope: "portal", secure: ctx.secure });
        return { status: "expired" as const };
      }

      const clientId = ensurePlexClientId();
      const token = await checkPlexPin(pinId, clientId);
      if (!token) return { status: "pending" as const };

      // Redeemed — one way or the other this handshake is spent.
      spendHandshake("portal", ctx.handshakeNonce);
      clearHandshakeCookie(ctx.resHeaders, { scope: "portal", secure: ctx.secure });

      const account = await getPlexAccount(token, clientId);
      if (!plexUserExists(account.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This Plex account isn't a user of this server.",
        });
      }
      const raw = createPlexSession(account.id, account.username, "portal");
      setSessionCookie(ctx.resHeaders, raw, { scope: "portal", secure: ctx.secure });
      return { status: "ok" as const, username: account.username };
    }),

    logout: publicProcedure.mutation(({ ctx }) => {
      deletePlexSession(ctx.rawToken);
      clearSessionCookie(ctx.resHeaders, { scope: "portal", secure: ctx.secure });
      return { ok: true };
    }),
  }),

  me: userProcedure.query(({ ctx }) => {
    return { userId: ctx.session.userId, username: ctx.session.username };
  }),

  preferences: tp.router({
    get: userProcedure.query(({ ctx }) => getUserPreferences(ctx.session.userId)),

    set: userProcedure
      .input(z.object({ preferences: userPreferencesSchema, optedIn: z.boolean() }))
      .mutation(({ ctx, input }) => {
        setUserPreferences(ctx.session.userId, input.preferences, input.optedIn);
        return { ok: true };
      }),
  }),

  /**
   * The collections Tinkerbell has built *for this user*, with a few titles
   * from each.
   *
   * The portal was a form and nothing else: you rated fourteen genres, pressed
   * Save, and never found out whether any of it worked. This is the other half
   * of the loop — what your answers produced, in the words the collection
   * actually carries on your home screen.
   *
   * Read from the local mirror rather than Plex: the mirror is what the sync
   * job keeps current, and a portal that opens a Plex connection per visitor
   * is a portal that falls over when the server is busy.
   */
  myCollections: userProcedure.query(({ ctx }) => {
    const rows = getCollectionsForUser(ctx.session.username);
    return rows.map((row) => ({
      ratingKey: row.plexRatingKey,
      title: row.title,
      summary: row.summary,
      itemCount: row.childCount,
    }));
  }),

  /**
   * "Not for me."
   *
   * Adds the title to `excludedTitles`, which is the same list the portal's
   * own picker writes to and the one every rule already honours — so this is a
   * new way to say something the system could already hear, rather than a
   * second preference store to keep in step.
   *
   * Idempotent: pressing it twice is one exclusion, not two.
   */
  notInterested: userProcedure
    .input(z.object({ title: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }) => {
      const current = getUserPreferences(ctx.session.userId);
      const excludedTitles = current.preferences.excludedTitles.includes(input.title)
        ? current.preferences.excludedTitles
        : [...current.preferences.excludedTitles, input.title];
      setUserPreferences(
        ctx.session.userId,
        { ...current.preferences, excludedTitles },
        // Opt-in is left exactly as it was. Saying "not this one" is not
        // consent to have your whole home screen rearranged.
        current.optedIn,
      );
      return { ok: true as const, excluded: excludedTitles.length };
    }),

  /**
   * What a cleanup rule is about to remove, and whether you have asked it to
   * stay.
   *
   * The queue page has always been able to say this, to exactly one person.
   * Everyone else found out when the film stopped being there — and the whole
   * argument for the streak is that a scheduled deletion is tolerable only
   * when somebody can see it coming.
   *
   * Held and protected items are left out. A list that included things
   * already spared would be asking people to worry about nothing, and a
   * portal that cries wolf is one nobody reads the week it matters.
   */
  leavingSoon: userProcedure.query(({ ctx }) => {
    const voted = keepVotesForUser(ctx.session.userId);
    return leavingSoon().map((item) => ({ ...item, voted: voted.has(item.ratingKey) }));
  }),

  /**
   * "I'd like to keep this."
   *
   * A signal, deliberately not a hold: a shared user must not be able to
   * silently overrule the server owner's rule. The vote appears on the admin's
   * queue beside the item, so a deletion nobody wanted becomes a decision
   * somebody made rather than one that happened at 4am.
   */
  voteKeep: userProcedure
    .input(z.object({ ratingKey: z.string().min(1), keep: z.boolean() }))
    .mutation(({ ctx, input }) => {
      if (input.keep) recordKeepVote(input.ratingKey, ctx.session.userId, ctx.session.username);
      else removeKeepVote(input.ratingKey, ctx.session.userId);
      return { ok: true as const };
    }),

  /**
   * What you have watched here.
   *
   * Scoped to the session's own user id and nobody else's — the portal has
   * never let one shared user read another's anything, and a watch history is
   * the last place to start.
   */
  myWatchSummary: userProcedure.query(({ ctx }) => userTotals(ctx.session.userId)),

  searchTitles: userProcedure.input(z.object({ q: z.string() })).query(({ input }) => searchMediaTitles(input.q, 15)),

  availableGenres: userProcedure.query(async () => {
    const client = getPlexClient();
    let sections = await client.getSections();
    const configured = getConfig("global_plex_libraries");
    if (configured) sections = sections.filter((s) => configured.includes(s.title));

    const genres = new Set<string>();
    for (const section of sections) {
      try {
        const values = await client.getFilterFieldValues(section.key, "genre");
        for (const v of values) genres.add(v.title);
      } catch {
        // Section without genre facets — skip.
      }
    }
    return [...genres].sort((a, b) => a.localeCompare(b));
  }),
});

export type PortalRouter = typeof portalRouter;
