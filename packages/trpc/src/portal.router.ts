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
import { createPlexPin, buildPlexAuthUrl, checkPlexPin, getPlexAccount } from "@tinkerbell/plex";
import { searchMediaTitles } from "@tinkerbell/domain.media";

const COOKIE = "tb_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // seconds

export interface PortalContext {
  session?: { userId: number; username: string };
  rawToken?: string;
  resHeaders: Headers;
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function createPortalContext(opts: { req: Request; resHeaders: Headers }): PortalContext {
  const rawToken = parseCookie(opts.req.headers.get("cookie") ?? "", COOKIE);
  return { session: getPlexSession(rawToken), rawToken, resHeaders: opts.resHeaders };
}

function setSessionCookie(headers: Headers, raw: string): void {
  headers.append("Set-Cookie", `${COOKIE}=${raw}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`);
}
function clearSessionCookie(headers: Headers): void {
  headers.append("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
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
    start: publicProcedure.input(z.object({ forwardUrl: z.string().url().optional() })).mutation(async ({ input }) => {
      const clientId = ensurePlexClientId();
      const pin = await createPlexPin(clientId);
      const forwardUrl = input.forwardUrl || getConfig("user_app_public_url") || "";
      return { id: pin.id, authUrl: buildPlexAuthUrl({ clientId, code: pin.code, forwardUrl }) };
    }),

    poll: publicProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
      const clientId = ensurePlexClientId();
      const token = await checkPlexPin(input.id, clientId);
      if (!token) return { status: "pending" as const };

      const account = await getPlexAccount(token, clientId);
      if (!plexUserExists(account.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This Plex account isn't a user of this server.",
        });
      }
      const raw = createPlexSession(account.id, account.username);
      setSessionCookie(ctx.resHeaders, raw);
      return { status: "ok" as const, username: account.username };
    }),

    logout: publicProcedure.mutation(({ ctx }) => {
      deletePlexSession(ctx.rawToken);
      clearSessionCookie(ctx.resHeaders);
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
