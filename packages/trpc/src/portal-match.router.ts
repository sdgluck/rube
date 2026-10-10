/**
 * Movie match, on the portal. See `@tinkerbell/domain.match` for what a room is.
 *
 * Three kinds of caller, and the procedure decides which it takes:
 *
 * - **Making a room** (`libraries`, `genres`, `presets`, `count`, `create`,
 *   `rooms`, `join`) is for a user of this server — a portal session — and
 *   nobody else. The libraries offered are theirs.
 * - **Being in a room** (`state`, `deck`, `swipe`, …) takes a session *or* a
 *   guest token, which the portal sends as `X-Match-Guest`. A guest token is
 *   good for its own room and nothing else — every other portal procedure still
 *   sees no session and refuses it.
 * - **The invite screen** (`guest.preview`, `guest.join`) is public: it is how
 *   somebody with no Plex account gets a token in the first place. Both need
 *   the invite secret, which is 128 bits and only ever shown inside the room.
 *
 * Everything is behind the `tab.match` component, which needs `match_enabled`
 * — switching movie match off closes every room's door at once, guests'
 * included.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { matchCodeSchema, matchFiltersSchema } from "@tinkerbell/contracts";
import { GUEST_NAME_MAX, MatchError, type Caller } from "@tinkerbell/domain.match";
import type { PlexClient } from "@tinkerbell/plex";
import type { TrpcDeps } from "./deps.ts";
import type { PortalProcedures } from "./portal.router.ts";

const room = z.object({ code: matchCodeSchema });
const invite = z.string().min(1).max(64);
const ratingKey = z.string().min(1).max(32);
const sectionId = z.string().min(1).max(32);

/** Synopses are fetched per deck page and kept, since a room's members all page through the same films. */
const SUMMARY_CACHE_MAX = 5000;

export function createPortalMatchRouter(
  deps: Pick<TrpcDeps, "match" | "config">,
  p: PortalProcedures & { requireComponent: (id: "tab.match") => void; getPlexClient: () => PlexClient },
) {
  const { match } = deps;
  const { getConfig } = deps.config;
  const { router, publicProcedure, userProcedure, rateLimit, requireComponent, getPlexClient } = p;

  /** The domain's refusals, as the tRPC errors of the same name. */
  function run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof MatchError) throw new TRPCError({ code: e.code, message: e.message });
      throw e;
    }
  }

  const creator = userProcedure.use(({ next }) => {
    requireComponent("tab.match");
    return next();
  });

  const member = publicProcedure.use(({ ctx, next }) => {
    const caller: Caller | undefined = ctx.session
      ? { userId: ctx.session.userId, username: ctx.session.username }
      : ctx.matchGuest
        ? { guestToken: ctx.matchGuest }
        : undefined;
    // UNAUTHORIZED before the component check, so `portal-surface.test.ts`
    // sees what every other session-gated procedure answers a stranger.
    if (!caller)
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in with Plex, or open the room's invite link." });
    requireComponent("tab.match");
    return next({ ctx: { ...ctx, caller } });
  });

  const invited = publicProcedure.use(({ next }) => {
    requireComponent("tab.match");
    return next();
  });

  const summaries = new Map<string, string>();
  async function withSummaries<F extends { ratingKey: string }>(films: F[]): Promise<Array<F & { summary: string }>> {
    const missing = films.map((f) => f.ratingKey).filter((k) => !summaries.has(k));
    if (missing.length > 0) {
      try {
        const fetched = await getPlexClient().getSummariesByRatingKeys(missing);
        // Recorded even when empty, so a film with no synopsis isn't asked for again.
        for (const key of missing) summaries.set(key, fetched.get(key) ?? "");
        while (summaries.size > SUMMARY_CACHE_MAX) summaries.delete(summaries.keys().next().value!);
      } catch {
        // A card without a synopsis still swipes. Plex being slow mustn't stop the room.
      }
    }
    return films.map((f) => ({ ...f, summary: summaries.get(f.ratingKey) ?? "" }));
  }

  let plexServerId: string | null | undefined;
  /** For "Open in Plex" on a match. Asked once; null when Plex didn't answer. */
  async function serverId(): Promise<string | null> {
    if (plexServerId !== undefined) return plexServerId;
    try {
      plexServerId = (await getPlexClient().getIdentity()).machineIdentifier;
    } catch {
      return null;
    }
    return plexServerId;
  }

  return router({
    libraries: creator.query(({ ctx }) => match.libraries(ctx.session.userId)),

    genres: creator
      .input(z.object({ sectionId }))
      .query(({ ctx, input }) => run(() => match.genres(ctx.session.userId, input.sectionId))),

    presets: creator
      .input(z.object({ sectionId }))
      .query(({ ctx, input }) => run(() => match.presets(ctx.session.userId, input.sectionId))),

    count: creator
      .input(z.object({ sectionId, filters: matchFiltersSchema }))
      .query(({ ctx, input }) => run(() => match.count(ctx.session.userId, input.sectionId, input.filters))),

    create: creator
      .input(z.object({ sectionId, filters: matchFiltersSchema }))
      .mutation(({ ctx, input }) => run(() => match.createRoom(ctx.session, input.sectionId, input.filters))),

    rooms: creator.query(({ ctx }) => match.myRooms(ctx.session.userId)),

    join: creator
      .input(room.extend({ invite: invite.optional() }))
      .mutation(({ ctx, input }) => run(() => match.join(ctx.session, input.code, input.invite))),

    state: member.input(room).query(async ({ ctx, input }) => {
      const state = run(() => match.state(ctx.caller, input.code));
      // The admin's public address when there is one — the link is going to
      // someone who isn't on this network — and the address this request came
      // in on otherwise. A fragment, so the secret never reaches a server log.
      const base = (getConfig("user_app_public_url") || ctx.origin).replace(/\/+$/, "");
      return {
        ...state,
        link: `${base}/#match/${state.code}/${state.invite}`,
        // A guest has no way into the server's Plex, so no link to it.
        plexServerId: state.me.guest ? null : await serverId(),
      };
    }),

    deck: member
      .input(room.extend({ exclude: z.array(ratingKey).max(100), limit: z.number().int().min(1).max(50) }))
      .query(async ({ ctx, input }) => {
        const page = run(() => match.deck(ctx.caller, input.code, input.exclude, input.limit));
        return { ...page, films: await withSummaries(page.films) };
      }),

    swipe: member
      .input(room.extend({ ratingKey, liked: z.boolean() }))
      .mutation(({ ctx, input }) => run(() => match.swipe(ctx.caller, input.code, input.ratingKey, input.liked))),

    undo: member
      .input(room.extend({ ratingKey }))
      .mutation(({ ctx, input }) => run(() => match.undo(ctx.caller, input.code, input.ratingKey))),

    reset: member.input(room).mutation(({ ctx, input }) => run(() => match.reset(ctx.caller, input.code))),

    vote: member
      .input(room.extend({ ratingKey: ratingKey.nullable() }))
      .mutation(({ ctx, input }) => run(() => match.vote(ctx.caller, input.code, input.ratingKey))),

    leave: member.input(room).mutation(({ ctx, input }) => run(() => match.leave(ctx.caller, input.code))),

    guest: router({
      preview: invited
        .input(room.extend({ invite }))
        .query(({ input }) => run(() => match.preview(input.code, input.invite))),

      join: invited
        .input(room.extend({ invite, name: z.string().trim().min(1).max(GUEST_NAME_MAX) }))
        .mutation(({ ctx, input }) => {
          // Each join is a new member row; the secret stops strangers, this stops a loop.
          rateLimit(ctx.ip);
          return run(() => match.joinAsGuest(input.code, input.invite, input.name));
        }),
    }),
  });
}
