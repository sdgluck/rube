/**
 * Movie match — a group swipes through one movie library, and a film every
 * member liked is a match.
 *
 * Ported from the standalone PlexMatch app, and the differences are its
 * reasons for being here rather than there:
 *
 * - **Who can do what.** PlexMatch let any Plex account sign in and swipe
 *   through the whole server. Here only a user of this server (a portal
 *   session) can create a room, and only in a library shared with them
 *   (`sharedSectionKeys`). Who they bring is their call: the invite link
 *   carries a secret that admits anyone, as a guest with nothing but a name and
 *   a token for that one room. Typing the short code is for the people on the
 *   sofa who already have the library — four characters can be guessed, so the
 *   code alone never shows a library to someone it isn't shared with.
 * - **Rooms are kept.** PlexMatch held them in memory, so a restart (which every
 *   Tinkerbell upgrade is) lost the evening. They are rows now, swept after
 *   `MATCH_ROOM_RETENTION_MS` without a visit.
 * - **The films come from the mirror** (`media_items`), not from Plex. The sync
 *   job already keeps it current, and a portal that pages a library out of Plex
 *   for every room is one that falls over when the server is busy. The one
 *   thing the mirror lacks, the synopsis, the router fetches per page.
 * - **No live socket.** Members poll `state`. A swipe changes nothing anyone has
 *   to see within a second, and a poll survives the things that break a
 *   long-lived connection on a self-hosted server: a reverse proxy that buffers
 *   it, a phone that suspends it, the native app that can't put a session
 *   header on one. Presence falls out of the poll — `lastSeenAt`.
 *
 * Every function takes the caller from the session or the guest token;
 * nothing here accepts somebody else's identity as an argument.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { token } from "@tinkerbell/container";
import { MATCH_CODE_ALPHABET, MATCH_CODE_LENGTH, type MatchFilters } from "@tinkerbell/contracts";
import { DAY_MS, type Sharing } from "@tinkerbell/core";
import { matchMembers, matchRooms, matchSwipes, mediaItems, plexSections, plexUsers, type Db } from "@tinkerbell/db";
import type { Clock } from "@tinkerbell/ports";

/** A room nobody has opened for this long is swept. Long enough to span a "let's finish this next weekend". */
export const MATCH_ROOM_RETENTION_MS = 30 * DAY_MS;

/** Polls arrive every few seconds; a member silent for longer than this has closed the room. */
export const ONLINE_WINDOW_MS = 15_000;

/** Each member's own copy of the room's last-seen time is written at most this often. */
const SEEN_WRITE_MS = 5_000;
/** The room's own activity stamp only matters to a 30-day sweep. */
const ACTIVE_WRITE_MS = 60_000;

/** How long a room's filtered deck is reused before the mirror is read again. */
const DECK_TTL_MS = 60_000;

export const DECK_PAGE_MAX = 50;

/** A user of this server, as the portal session knows them. */
export interface ServerUser {
  userId: number;
  username: string;
}

/** Whoever is calling: a portal session, or a guest's room token. */
export type Caller = ServerUser | { guestToken: string };

export const GUEST_NAME_MAX = 40;

export type MatchErrorCode = "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST";

/** A refusal the router turns into the tRPC error of the same code. */
export class MatchError extends Error {
  readonly code: MatchErrorCode;
  constructor(code: MatchErrorCode, message: string) {
    super(message);
    this.name = "MatchError";
    this.code = code;
  }
}

/** One film, as a card or a match shows it. */
export interface MatchFilm {
  ratingKey: string;
  title: string;
  year: number | null;
  /** A signed path on the portal, or null when Plex has no poster. */
  poster: string | null;
  rating: number | null;
  contentRating: string | null;
  durationMs: number | null;
  genres: string[];
}

interface FilmRow {
  ratingKey: string;
  title: string;
  year: number | null;
  thumb: string | null;
  genres: string[] | null;
  rating: number | null;
  contentRating: string | null;
  durationMs: number | null;
}

type Room = typeof matchRooms.$inferSelect;
type MemberRow = typeof matchMembers.$inferSelect;

export interface MatchDeps {
  db: Db;
  now: Clock;
  sharing: Pick<Sharing, "sharedSectionKeys">;
}

export function createMatch(deps: MatchDeps) {
  const { db, now, sharing } = deps;

  // ── Films ─────────────────────────────────────────────────────────────────

  const FILM_COLUMNS = {
    ratingKey: mediaItems.ratingKey,
    title: mediaItems.title,
    year: mediaItems.year,
    thumb: mediaItems.thumb,
    genres: mediaItems.genres,
    rating: mediaItems.rating,
    contentRating: mediaItems.contentRating,
    durationMs: mediaItems.durationMs,
  };

  function sectionFilms(sectionId: string): FilmRow[] {
    return db
      .select(FILM_COLUMNS)
      .from(mediaItems)
      .where(and(eq(mediaItems.sectionId, sectionId), eq(mediaItems.type, "movie")))
      .all();
  }

  function filmsByKey(keys: string[]): Map<string, FilmRow> {
    const out = new Map<string, FilmRow>();
    // SQLite caps bound parameters; a page or a match list is far below it, but
    // a long-running room's matches might not be.
    for (let i = 0; i < keys.length; i += 500) {
      const rows = db
        .select(FILM_COLUMNS)
        .from(mediaItems)
        .where(inArray(mediaItems.ratingKey, keys.slice(i, i + 500)))
        .all();
      for (const row of rows) out.set(row.ratingKey, row);
    }
    return out;
  }

  /** An unknown value passes a bound — see the note on `matchFiltersSchema`. */
  function passes(film: FilmRow, filters: MatchFilters): boolean {
    const genres = filters.genres ?? [];
    if (genres.length > 0 && !(film.genres ?? []).some((g) => genres.includes(g))) return false;
    if (filters.maxMinutes && film.durationMs != null && film.durationMs / 60_000 > filters.maxMinutes) return false;
    if (filters.minYear && film.year != null && film.year < filters.minYear) return false;
    if (filters.maxYear && film.year != null && film.year > filters.maxYear) return false;
    if (filters.minRating !== undefined && film.rating != null && film.rating < filters.minRating) return false;
    if (filters.maxRating !== undefined && film.rating != null && film.rating >= filters.maxRating) return false;
    return true;
  }

  // ── Posters ───────────────────────────────────────────────────────────────
  //
  // The portal has no Plex image proxy — the admin's is gated on an admin
  // session, and the native app's `<img>` can't carry a portal one anyway. So a
  // film's poster is a path that carries its own permission: an HMAC of the
  // rating key, minted only for films this caller was allowed to be shown. The
  // key is per process, so a restart invalidates outstanding paths; the next
  // poll hands out fresh ones.

  const posterKey = randomBytes(32);

  function posterSig(ratingKey: string): string {
    return createHmac("sha256", posterKey).update(ratingKey).digest("base64url").slice(0, 22);
  }

  function posterPath(film: { ratingKey: string; thumb: string | null }): string | null {
    if (!film.thumb) return null;
    return `/api/match/poster/${encodeURIComponent(film.ratingKey)}?sig=${posterSig(film.ratingKey)}`;
  }

  /** The Plex thumb path behind a poster URL, if its signature is ours. */
  function posterThumb(ratingKey: string, sig: string | null): string | null {
    if (!sig) return null;
    const expected = Buffer.from(posterSig(ratingKey));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const row = db
      .select({ thumb: mediaItems.thumb })
      .from(mediaItems)
      .where(eq(mediaItems.ratingKey, ratingKey))
      .get();
    return row?.thumb ?? null;
  }

  function toFilm(row: FilmRow): MatchFilm {
    return {
      ratingKey: row.ratingKey,
      title: row.title,
      year: row.year,
      poster: posterPath(row),
      rating: row.rating,
      contentRating: row.contentRating,
      durationMs: row.durationMs,
      genres: row.genres ?? [],
    };
  }

  // ── Libraries ─────────────────────────────────────────────────────────────

  function canSee(userId: number, sectionId: string): boolean {
    const shared = sharing.sharedSectionKeys(userId);
    return shared.length === 0 || shared.includes(sectionId);
  }

  /** The movie libraries this user can make a room in, with how many films each holds. */
  function libraries(userId: number): Array<{ key: string; title: string; count: number }> {
    const counts = db
      .select({ sectionId: mediaItems.sectionId, count: sql<number>`count(*)` })
      .from(mediaItems)
      .where(eq(mediaItems.type, "movie"))
      .groupBy(mediaItems.sectionId)
      .all();
    const byId = new Map(counts.map((c) => [c.sectionId, c.count]));
    return db
      .select({ key: plexSections.key, title: plexSections.title })
      .from(plexSections)
      .where(eq(plexSections.type, "movie"))
      .all()
      .filter((s) => canSee(userId, s.key) && (byId.get(s.key) ?? 0) > 0)
      .map((s) => ({ ...s, count: byId.get(s.key) ?? 0 }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function requireLibrary(userId: number, sectionId: string): void {
    if (!libraries(userId).some((l) => l.key === sectionId)) {
      throw new MatchError("FORBIDDEN", "That library isn't one you can use.");
    }
  }

  function genres(userId: number, sectionId: string): string[] {
    requireLibrary(userId, sectionId);
    const set = new Set<string>();
    for (const film of sectionFilms(sectionId)) for (const g of film.genres ?? []) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  function count(userId: number, sectionId: string, filters: MatchFilters): number {
    requireLibrary(userId, sectionId);
    return sectionFilms(sectionId).filter((f) => passes(f, filters)).length;
  }

  /**
   * Ready-made rooms — "hidden gem Thriller of the 90s" — chosen among the
   * combinations this library has enough films for. The floor scales with the
   * library, so a small one still gets some, but never below ten: a preset you
   * finish in two minutes is not a movie night.
   */
  function presets(userId: number, sectionId: string): Array<{ label: string; filters: MatchFilters; count: number }> {
    requireLibrary(userId, sectionId);
    const films = sectionFilms(sectionId);
    const floor = Math.max(10, Math.min(50, Math.floor(films.length / 20)));
    const allGenres = new Set<string>();
    for (const f of films) for (const g of f.genres ?? []) allGenres.add(g);

    const candidates: Array<{ label: string; filters: MatchFilters; count: number }> = [];
    for (const genre of allGenres) {
      for (const decade of DECADES) {
        for (const quality of QUALITY) {
          const filters: MatchFilters = {
            genres: [genre],
            minYear: decade.minYear,
            maxYear: decade.maxYear,
            ...(quality.minRating !== undefined ? { minRating: quality.minRating } : {}),
            ...(quality.maxRating !== undefined ? { maxRating: quality.maxRating } : {}),
          };
          // Unknowns pass a bound, which is right for a deck and wrong for a
          // label: "the worst Horror of the 80s" must actually be rated.
          const n = films.filter((f) => f.rating != null && passes(f, filters)).length;
          if (n >= floor)
            candidates.push({ label: `${quality.adj} ${genre} of the ${decade.label}`, filters, count: n });
        }
      }
    }
    return shuffle(candidates, Math.random).slice(0, 10);
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  function newCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < MATCH_CODE_LENGTH; i++) code += MATCH_CODE_ALPHABET[randomInt(MATCH_CODE_ALPHABET.length)];
      if (!db.select({ id: matchRooms.id }).from(matchRooms).where(eq(matchRooms.code, code)).get()) return code;
    }
    throw new Error("Couldn't find a free room code.");
  }

  function thumbOf(userId: number): string | null {
    return (
      db.select({ thumb: plexUsers.thumb }).from(plexUsers).where(eq(plexUsers.userId, userId)).get()?.thumb ?? null
    );
  }

  function addUserMember(roomId: number, user: ServerUser): void {
    const at = now();
    db.insert(matchMembers)
      .values({
        roomId,
        userId: user.userId,
        name: user.username,
        thumb: thumbOf(user.userId),
        joinedAt: at,
        lastSeenAt: at,
      })
      .onConflictDoUpdate({
        target: [matchMembers.roomId, matchMembers.userId],
        set: { name: user.username, lastSeenAt: at },
      })
      .run();
  }

  function touchRoom(room: Room, force = false): void {
    const at = now();
    if (!force && at - room.lastActiveAt < ACTIVE_WRITE_MS) return;
    db.update(matchRooms).set({ lastActiveAt: at }).where(eq(matchRooms.id, room.id)).run();
  }

  function createRoom(user: ServerUser, sectionId: string, filters: MatchFilters): { code: string; invite: string } {
    requireLibrary(user.userId, sectionId);
    const at = now();
    const code = newCode();
    const invite = randomBytes(16).toString("base64url");
    const room = db
      .insert(matchRooms)
      .values({
        code,
        inviteSecret: invite,
        sectionId,
        filters,
        seed: randomInt(2 ** 31),
        createdByUserId: user.userId,
        createdAt: at,
        lastActiveAt: at,
      })
      .returning()
      .get();
    addUserMember(room.id, user);
    return { code, invite };
  }

  /**
   * A live room, or NOT_FOUND. A room is gone once it is past its retention
   * window (whether or not the sweep has run), and once its creator can no
   * longer see its library — it was their share it showed, and unsharing has
   * to take the room with it, as it does every other portal surface. A creator
   * who is no longer a user of this server at all counts: with no share row,
   * `sharedSectionKeys` would otherwise read as "every library".
   */
  function findRoom(code: string): Room {
    const room = db.select().from(matchRooms).where(eq(matchRooms.code, code)).get();
    const creatorStillHere =
      room &&
      db.select({ id: plexUsers.userId }).from(plexUsers).where(eq(plexUsers.userId, room.createdByUserId)).get();
    if (
      !room ||
      now() - room.lastActiveAt > MATCH_ROOM_RETENTION_MS ||
      !creatorStillHere ||
      !canSee(room.createdByUserId, room.sectionId)
    ) {
      throw new MatchError("NOT_FOUND", "That room doesn't exist, or has closed.");
    }
    return room;
  }

  function inviteMatches(room: Room, invite: string | undefined): boolean {
    if (!invite) return false;
    const a = Buffer.from(room.inviteSecret);
    const b = Buffer.from(invite);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** A room reached by its invite link, or NOT_FOUND — never "wrong secret", which would confirm the code. */
  function findInvited(code: string, invite: string): Room {
    const room = findRoom(code);
    if (!inviteMatches(room, invite)) throw new MatchError("NOT_FOUND", "That room doesn't exist, or has closed.");
    return room;
  }

  /**
   * A server user opening a room. Idempotent — the portal calls it every time
   * it opens one, so a member coming back is a no-op and a newcomer is added.
   * The invite link admits them whatever their share; the bare code only if the
   * room's library is one they can already see.
   */
  function join(user: ServerUser, code: string, invite?: string): { code: string } {
    const room = findRoom(code);
    const already = db
      .select({ id: matchMembers.id })
      .from(matchMembers)
      .where(and(eq(matchMembers.roomId, room.id), eq(matchMembers.userId, user.userId)))
      .get();
    if (!already && !inviteMatches(room, invite) && !canSee(user.userId, room.sectionId)) {
      throw new MatchError(
        "FORBIDDEN",
        "This room is for a library that isn't shared with you. Ask for its invite link.",
      );
    }
    addUserMember(room.id, user);
    touchRoom(room, true);
    return { code: room.code };
  }

  /** What the invite screen shows before somebody picks a name. */
  function preview(code: string, invite: string) {
    const room = findInvited(code, invite);
    return {
      code: room.code,
      library: sectionTitle(room.sectionId),
      filters: room.filters as MatchFilters,
      members: db
        .select({ name: matchMembers.name })
        .from(matchMembers)
        .where(eq(matchMembers.roomId, room.id))
        .all()
        .map((m) => m.name),
    };
  }

  /**
   * Somebody with the invite link and no session joins as a guest. Returns the
   * only copy of their token; the room keeps its hash.
   */
  function joinAsGuest(code: string, invite: string, name: string): { token: string } {
    const room = findInvited(code, invite);
    const token = randomBytes(32).toString("base64url");
    const at = now();
    db.insert(matchMembers)
      .values({
        roomId: room.id,
        guestTokenHash: hashToken(token),
        name: name.trim().slice(0, GUEST_NAME_MAX),
        joinedAt: at,
        lastSeenAt: at,
      })
      .run();
    touchRoom(room, true);
    return { token };
  }

  function requireMember(caller: Caller, code: string): { room: Room; member: MemberRow } {
    const room = findRoom(code);
    const member =
      "guestToken" in caller
        ? db
            .select()
            .from(matchMembers)
            .where(and(eq(matchMembers.roomId, room.id), eq(matchMembers.guestTokenHash, hashToken(caller.guestToken))))
            .get()
        : db
            .select()
            .from(matchMembers)
            .where(and(eq(matchMembers.roomId, room.id), eq(matchMembers.userId, caller.userId)))
            .get();
    if (!member) throw new MatchError("FORBIDDEN", "Join the room first.");
    return { room, member };
  }

  /**
   * Leaving takes your swipes and your vote with you (the swipes by cascade).
   * A match is "everyone in the room liked it", so a member who has gone must
   * stop counting — both as someone whose like it needs and as someone whose
   * like it has. The last one out closes the room.
   */
  function leave(caller: Caller, code: string): void {
    const { room, member } = requireMember(caller, code);
    db.transaction((tx) => {
      tx.delete(matchMembers).where(eq(matchMembers.id, member.id)).run();
      const left = tx
        .select({ n: sql<number>`count(*)` })
        .from(matchMembers)
        .where(eq(matchMembers.roomId, room.id))
        .get();
      if ((left?.n ?? 0) === 0) tx.delete(matchRooms).where(eq(matchRooms.id, room.id)).run();
    });
  }

  function sectionTitle(sectionId: string): string {
    return (
      db.select({ title: plexSections.title }).from(plexSections).where(eq(plexSections.key, sectionId)).get()?.title ??
      ""
    );
  }

  /** The rooms a server user is in, most recently active first. Guests keep theirs on their device. */
  function myRooms(userId: number) {
    const rooms = db
      .select({
        id: matchRooms.id,
        code: matchRooms.code,
        sectionId: matchRooms.sectionId,
        filters: matchRooms.filters,
      })
      .from(matchRooms)
      .innerJoin(matchMembers, eq(matchMembers.roomId, matchRooms.id))
      .where(eq(matchMembers.userId, userId))
      .orderBy(desc(matchRooms.lastActiveAt))
      .limit(20)
      .all()
      .filter((r) => {
        try {
          findRoom(r.code);
          return true;
        } catch {
          return false;
        }
      });
    const members = rooms.length
      ? db
          .select({ roomId: matchMembers.roomId, name: matchMembers.name })
          .from(matchMembers)
          .where(
            inArray(
              matchMembers.roomId,
              rooms.map((r) => r.id),
            ),
          )
          .all()
      : [];
    return rooms.map((r) => ({
      code: r.code,
      library: sectionTitle(r.sectionId),
      filters: r.filters as MatchFilters,
      members: members.filter((m) => m.roomId === r.id).map((m) => m.name),
    }));
  }

  // ── The deck ──────────────────────────────────────────────────────────────

  const deckCache = new Map<number, { at: number; keys: string[] }>();

  /**
   * The room's films in its shuffled order. Recomputed at most once a minute
   * per room: the poll asks for the deck's size every few seconds per member,
   * and the filter is a pass over every film in the library.
   */
  function deckKeys(room: Room): string[] {
    const cached = deckCache.get(room.id);
    if (cached && now() - cached.at < DECK_TTL_MS) return cached.keys;
    const filters = room.filters as MatchFilters;
    const keys = sectionFilms(room.sectionId)
      .filter((f) => passes(f, filters))
      .map((f) => ({ key: f.ratingKey, rank: rankOf(room.seed, f.ratingKey) }))
      .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))
      .map((f) => f.key);
    deckCache.set(room.id, { at: now(), keys });
    return keys;
  }

  function swipedBy(memberId: number): Set<string> {
    return new Set(
      db
        .select({ ratingKey: matchSwipes.ratingKey })
        .from(matchSwipes)
        .where(eq(matchSwipes.memberId, memberId))
        .all()
        .map((r) => r.ratingKey),
    );
  }

  /**
   * The caller's next films: the room's order, minus what they have swiped and
   * what the portal is already holding (`exclude`). Paging by "what you don't
   * have yet" rather than by offset, because the unswiped list shrinks with
   * every swipe — an offset into it skips a film for each swipe since the last
   * page, which is exactly what the original did.
   */
  function deck(caller: Caller, code: string, exclude: string[], limit: number) {
    const { room, member } = requireMember(caller, code);
    const skip = swipedBy(member.id);
    for (const key of exclude) skip.add(key);
    const pageKeys: string[] = [];
    let remaining = 0;
    for (const key of deckKeys(room)) {
      if (skip.has(key)) continue;
      remaining++;
      if (pageKeys.length < Math.min(limit, DECK_PAGE_MAX)) pageKeys.push(key);
    }
    const rows = filmsByKey(pageKeys);
    return {
      films: pageKeys.flatMap((k) => {
        const row = rows.get(k);
        return row ? [toFilm(row)] : [];
      }),
      /** Unswiped films beyond what the portal already holds, this page included. */
      remaining,
    };
  }

  function requireInDeck(room: Room, ratingKey: string): void {
    if (!deckKeys(room).includes(ratingKey)) throw new MatchError("BAD_REQUEST", "That film isn't in this room.");
  }

  function countWhere(table: typeof matchMembers | typeof matchSwipes, where: ReturnType<typeof and>): number {
    return (
      db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .where(where)
        .get()?.n ?? 0
    );
  }

  /** Records a swipe. `matched` is whether this one made the film unanimous. */
  function swipe(caller: Caller, code: string, ratingKey: string, liked: boolean): { matched: boolean } {
    const { room, member } = requireMember(caller, code);
    requireInDeck(room, ratingKey);
    const at = now();
    db.insert(matchSwipes)
      .values({ memberId: member.id, roomId: room.id, ratingKey, liked, swipedAt: at })
      .onConflictDoUpdate({ target: [matchSwipes.memberId, matchSwipes.ratingKey], set: { liked, swipedAt: at } })
      .run();
    touchRoom(room);
    const members = countWhere(matchMembers, eq(matchMembers.roomId, room.id));
    const likes = countWhere(
      matchSwipes,
      and(eq(matchSwipes.roomId, room.id), eq(matchSwipes.ratingKey, ratingKey), eq(matchSwipes.liked, true)),
    );
    return { matched: liked && members >= 2 && likes >= members };
  }

  function undo(caller: Caller, code: string, ratingKey: string): void {
    const { member } = requireMember(caller, code);
    db.delete(matchSwipes)
      .where(and(eq(matchSwipes.memberId, member.id), eq(matchSwipes.ratingKey, ratingKey)))
      .run();
  }

  /** "Start over": forget your swipes in this room, not anyone else's. */
  function reset(caller: Caller, code: string): void {
    const { member } = requireMember(caller, code);
    db.delete(matchSwipes).where(eq(matchSwipes.memberId, member.id)).run();
  }

  /** "Watch this" — one per member; null withdraws it. */
  function vote(caller: Caller, code: string, ratingKey: string | null): void {
    const { room, member } = requireMember(caller, code);
    if (ratingKey !== null) requireInDeck(room, ratingKey);
    db.update(matchMembers).set({ voteRatingKey: ratingKey }).where(eq(matchMembers.id, member.id)).run();
    touchRoom(room);
  }

  // ── The poll ──────────────────────────────────────────────────────────────

  /**
   * Everything a room's screen shows, in one call, because the portal polls it.
   * Also the heartbeat: it is how the room knows who still has it open.
   */
  function state(caller: Caller, code: string) {
    const { room, member: self } = requireMember(caller, code);
    const at = now();
    if (at - self.lastSeenAt >= SEEN_WRITE_MS) {
      db.update(matchMembers).set({ lastSeenAt: at }).where(eq(matchMembers.id, self.id)).run();
    }
    touchRoom(room);

    const members = db.select().from(matchMembers).where(eq(matchMembers.roomId, room.id)).all();
    const swipes = db
      .select({
        memberId: matchSwipes.memberId,
        ratingKey: matchSwipes.ratingKey,
        liked: matchSwipes.liked,
        swipedAt: matchSwipes.swipedAt,
      })
      .from(matchSwipes)
      .where(eq(matchSwipes.roomId, room.id))
      .all();
    const names = new Map(members.map((m) => [m.id, m.name]));

    const likes = new Map<string, { by: string[]; lastAt: number }>();
    const swipedFilms = new Set<string>();
    for (const sw of swipes) {
      swipedFilms.add(sw.ratingKey);
      if (!sw.liked) continue;
      const entry = likes.get(sw.ratingKey) ?? { by: [], lastAt: 0 };
      entry.by.push(names.get(sw.memberId) ?? "");
      entry.lastAt = Math.max(entry.lastAt, sw.swipedAt);
      likes.set(sw.ratingKey, entry);
    }
    // More than one like, as the original had it: one person liking a film is
    // just their swipe, not something the room agrees on.
    const liked = [...likes].filter(([, l]) => l.by.length > 1);
    const rows = filmsByKey(liked.map(([key]) => key));
    const matches = liked
      .flatMap(([key, l]) => {
        const row = rows.get(key);
        if (!row) return [];
        return [
          {
            ...toFilm(row),
            likedBy: l.by.sort((x, y) => x.localeCompare(y)),
            unanimous: members.length >= 2 && l.by.length >= members.length,
            lastLikedAt: l.lastAt,
          },
        ];
      })
      .sort((x, y) => y.likedBy.length - x.likedBy.length || y.lastLikedAt - x.lastLikedAt);

    const votes = new Map<string, string[]>();
    for (const m of members) {
      if (m.voteRatingKey) votes.set(m.voteRatingKey, [...(votes.get(m.voteRatingKey) ?? []), m.name]);
    }

    const tally = (memberId: number) => {
      const own = swipes.filter((sw) => sw.memberId === memberId);
      return { swiped: own.length, liked: own.filter((sw) => sw.liked).length };
    };

    return {
      code: room.code,
      /** Every member may pass the link on — bringing people is what it is for. */
      invite: room.inviteSecret,
      library: sectionTitle(room.sectionId),
      filters: room.filters as MatchFilters,
      deckSize: deckKeys(room).length,
      me: { name: self.name, guest: self.userId === null, ...tally(self.id) },
      members: members
        .sort((x, y) => x.joinedAt - y.joinedAt)
        .map((m) => ({
          id: m.id,
          name: m.name,
          thumb: m.thumb,
          guest: m.userId === null,
          me: m.id === self.id,
          // The caller is online by definition — they are asking.
          online: m.id === self.id || at - m.lastSeenAt <= ONLINE_WINDOW_MS,
          ...tally(m.id),
        })),
      matches,
      unanimousCount: matches.filter((m) => m.unanimous).length,
      swipedCount: swipedFilms.size,
      votes: [...votes].map(([ratingKey, voters]) => ({ ratingKey, voters })),
      myVote: self.voteRatingKey,
    };
  }

  /** The retention sweep. Members and swipes go with their room (cascade). */
  function pruneStaleRooms(cutoff: number = now() - MATCH_ROOM_RETENTION_MS): number {
    const result = db.delete(matchRooms).where(lt(matchRooms.lastActiveAt, cutoff)).run();
    deckCache.clear();
    return result.changes;
  }

  return {
    count,
    createRoom,
    deck,
    genres,
    join,
    joinAsGuest,
    leave,
    libraries,
    myRooms,
    posterThumb,
    presets,
    preview,
    pruneStaleRooms,
    reset,
    state,
    swipe,
    undo,
    vote,
  };
}

export type Match = ReturnType<typeof createMatch>;

export const MatchToken = token<Match>("match");

const DECADES = [
  { label: "60s", minYear: 1960, maxYear: 1969 },
  { label: "70s", minYear: 1970, maxYear: 1979 },
  { label: "80s", minYear: 1980, maxYear: 1989 },
  { label: "90s", minYear: 1990, maxYear: 1999 },
  { label: "2000s", minYear: 2000, maxYear: 2009 },
  { label: "2010s", minYear: 2010, maxYear: 2019 },
  { label: "2020s", minYear: 2020, maxYear: 2029 },
];

const QUALITY: Array<{ adj: string; minRating?: number; maxRating?: number }> = [
  { adj: "top", minRating: 7 },
  { adj: "best", minRating: 6 },
  { adj: "hidden gem", minRating: 5, maxRating: 7 },
  { adj: "worst", maxRating: 4 },
  { adj: "so-bad-it's-good", maxRating: 3 },
];

/**
 * A film's place in a room's deck: FNV-1a over the seed and the rating key.
 * Stable per room, different between rooms, and independent of the rest of
 * the library — so a film added later lands somewhere in the deck rather than
 * reshuffling it under everyone's thumbs.
 */
export function rankOf(seed: number, ratingKey: string): number {
  let h = 0x811c9dc5 ^ seed;
  const s = `${seed}:${ratingKey}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
