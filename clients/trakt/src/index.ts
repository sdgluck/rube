/**
 * Trakt lists — search, metadata and items.
 *
 * Scope note, because it's the first question anyone asks: this reads *public*
 * lists, authenticated with nothing but a client id. That is deliberate, and
 * it is not the same as "Trakt support is half-finished".
 *
 * Trakt's API splits cleanly. Public lists — `trakt_list`, `trakt_userlist`,
 * the official charts, and the `/search/list` and `/lists/trending` endpoints
 * this client adds — need only an API key, which an admin pastes once.
 * Anything tied to a *person* — their watchlist, their collection, their
 * recommendations — needs the full OAuth device flow, with token storage and
 * refresh, and it authenticates one Trakt account rather than the server. The
 * first group covers the overwhelming majority of what Kometa configs use, so
 * it ships first and on its own; the second is a different feature wearing the
 * same name, and pretending otherwise would mean shipping an OAuth flow nobody
 * asked for yet.
 *
 * A private or user-scoped list therefore fails with a message saying which
 * kind of thing it is, rather than a bare 401.
 *
 * This lived in `packages/jobs/.../sources/trakt.ts` until Discover grew a
 * list search and `packages/trpc` needed the same auth headers and the same
 * reference parsing. One copy, here, so the two can't drift.
 */

import { httpRequestJson, HttpError } from "@rube/http";

const TRAKT_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = "https://api.trakt.tv";

/** One page of list items; Trakt caps at 1000 per page. */
const PAGE_LIMIT = 1000;
/** Stop after this many pages, so a runaway list can't stall a run. */
const MAX_PAGES = 10;
/** Search and browse endpoints only ever feed one screen. */
const BROWSE_LIMIT = 40;

export type TraktHealthCallback = (status: "ok" | "error", message: string) => void;

export interface TraktClientOptions {
  /** Null is allowed so the client can be constructed before it is configured. */
  clientId: string | null;
  onHealth?: TraktHealthCallback;
  /** Overridden by tests pointing at the mock server. */
  baseUrl?: string;
}

export interface TraktListSummary {
  /** Trakt's numeric list id — what a rule stores, because a slug follows renames. */
  id: number;
  name: string;
  slug: string;
  owner: string;
  description: string;
  itemCount: number;
  likes: number;
}

export interface TraktListItem {
  title: string;
  year: number | null;
  mediaType: "movie" | "show";
  imdbId: string | null;
  tmdbId: number | null;
}

interface RawIds {
  trakt?: number | null;
  slug?: string | null;
  imdb?: string | null;
  tmdb?: number | null;
}

interface RawList {
  name?: string;
  description?: string | null;
  item_count?: number;
  likes?: number;
  ids?: RawIds;
  user?: { username?: string | null; ids?: { slug?: string | null } };
}

/** `/search/list` and `/lists/trending` both wrap the list in an envelope. */
interface RawListEnvelope {
  list?: RawList;
  like_count?: number;
}

interface RawListItemEntry {
  movie?: { title?: string; year?: number | null; ids?: RawIds };
  show?: { title?: string; year?: number | null; ids?: RawIds };
}

/**
 * Resolve a Trakt list reference to its API path.
 *
 * Kometa configs write these as full share URLs far more often than as ids,
 * so the URL form is the one that has to work. Both segments are encoded
 * independently: a list slug can contain characters that would otherwise walk
 * out of the path and into the query string.
 */
export function traktListPath(reference: string): string {
  const trimmed = reference.trim().replace(/\/+$/, "");

  // https://trakt.tv/users/<user>/lists/<slug>
  const url = trimmed.match(/trakt\.tv\/users\/([^/]+)\/lists\/([^/?#]+)/i);
  if (url) return `/users/${encodeURIComponent(url[1]!)}/lists/${encodeURIComponent(url[2]!)}`;

  // <user>/<slug>, the short form.
  const short = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) return `/users/${encodeURIComponent(short[1]!)}/lists/${encodeURIComponent(short[2]!)}`;

  // A bare numeric id addresses a list directly.
  if (/^\d+$/.test(trimmed)) return `/lists/${encodeURIComponent(trimmed)}`;

  throw new Error(
    `Couldn't read "${reference}" as a Trakt list. Use the list's URL (https://trakt.tv/users/…/lists/…) or "user/list-slug".`,
  );
}

function toSummary(raw: RawList, likesFallback?: number): TraktListSummary {
  return {
    id: raw.ids?.trakt ?? 0,
    name: raw.name?.trim() ?? "",
    slug: raw.ids?.slug ?? "",
    owner: raw.user?.username ?? raw.user?.ids?.slug ?? "",
    description: raw.description?.trim() ?? "",
    itemCount: raw.item_count ?? 0,
    likes: raw.likes ?? likesFallback ?? 0,
  };
}

function toItem(entry: RawListItemEntry): TraktListItem | null {
  const media = entry.movie ? ("movie" as const) : entry.show ? ("show" as const) : null;
  if (!media) return null;
  const node = entry.movie ?? entry.show!;
  return {
    title: node.title?.trim() ?? "",
    year: node.year ?? null,
    mediaType: media,
    imdbId: node.ids?.imdb ?? null,
    tmdbId: typeof node.ids?.tmdb === "number" ? node.ids.tmdb : null,
  };
}

export function createTraktClient(opts: TraktClientOptions) {
  const { clientId, onHealth } = opts;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  function requireClientId(): string {
    if (!clientId) throw new Error("Trakt API key is not configured (Settings → Databases).");
    return clientId;
  }

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const key = requireClientId();
    try {
      const data = await httpRequestJson<T>({
        url: `${baseUrl}${path}`,
        init: {
          signal,
          headers: {
            "Content-Type": "application/json",
            "trakt-api-version": "2",
            "trakt-api-key": key,
          },
        },
        timeoutMs: TRAKT_TIMEOUT_MS,
        // Idempotent GET — retrying a transient 502 beats failing the run.
        retries: 2,
      });
      onHealth?.("ok", `${path} → 200`);
      return data;
    } catch (err) {
      const detail = err instanceof HttpError ? String(err.status) : (err as Error).message;
      onHealth?.("error", `${path} → ${detail}`);
      throw err;
    }
  }

  /** Search public lists by name. */
  async function searchLists(query: string, signal?: AbortSignal): Promise<TraktListSummary[]> {
    const raw = await get<RawListEnvelope[]>(
      `/search/list?query=${encodeURIComponent(query)}&limit=${BROWSE_LIMIT}`,
      signal,
    );
    return (Array.isArray(raw) ? raw : []).flatMap((e) => (e.list ? [toSummary(e.list, e.like_count)] : []));
  }

  /** The browse state, before anyone types. */
  async function trendingLists(signal?: AbortSignal): Promise<TraktListSummary[]> {
    const raw = await get<RawListEnvelope[]>(`/lists/trending?limit=${BROWSE_LIMIT}`, signal);
    return (Array.isArray(raw) ? raw : []).flatMap((e) => (e.list ? [toSummary(e.list, e.like_count)] : []));
  }

  /**
   * A list's metadata.
   *
   * Trakt answers 401/403 for both "bad key" and "this list isn't public",
   * and the difference is the whole fix — so say which one is likelier.
   */
  async function getList(reference: string, signal?: AbortSignal): Promise<TraktListSummary> {
    const path = traktListPath(reference);
    try {
      return toSummary(await get<RawList>(path, signal));
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (/\b401\b|\b403\b/.test(message)) {
        throw new Error(
          `Trakt refused access to "${reference}". Private lists, watchlists and personal collections need a Trakt sign-in, which isn't supported yet — check the list is public.`,
        );
      }
      if (/\b404\b/.test(message)) throw new Error(`Trakt list "${reference}" doesn't exist (or is no longer public).`);
      throw err;
    }
  }

  /**
   * A list's titles, paged.
   *
   * Paged rather than trusting one request to hold the lot: Trakt caps a page
   * at 1000, and "Top 5000 Movies of All Time" is exactly the kind of list
   * people put in a Kometa config. `limit` bounds the whole walk, so the
   * Discover preview asks for one screenful and the rule asks for everything.
   */
  async function getListItems(
    reference: string,
    opts: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<TraktListItem[]> {
    const base = traktListPath(reference);
    const ceiling = opts.limit ?? Infinity;
    const out: TraktListItem[] = [];

    for (let page = 1; page <= MAX_PAGES && out.length < ceiling; page++) {
      opts.signal?.throwIfAborted();
      const want = Math.min(PAGE_LIMIT, ceiling - out.length);
      const entries = await get<RawListItemEntry[]>(`${base}/items?page=${page}&limit=${want}`, opts.signal);
      if (!Array.isArray(entries) || entries.length === 0) break;
      for (const entry of entries) {
        const item = toItem(entry);
        if (item) out.push(item);
      }
      // A short page is the last page.
      if (entries.length < want) break;
    }

    return ceiling === Infinity ? out : out.slice(0, ceiling);
  }

  return { searchLists, trendingLists, getList, getListItems };
}

export type TraktClient = ReturnType<typeof createTraktClient>;
