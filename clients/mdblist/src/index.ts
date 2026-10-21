/**
 * MDBList — public list search, metadata and items.
 *
 * This used to live inline in `packages/jobs/.../sources/mdblist.ts` as a
 * `fetch` against a hand-built URL. It moved here when Discover grew a list
 * search, because the alternative was a second copy of the same api-key
 * handling and the same reference parsing in `packages/trpc` — and the two
 * copies would have disagreed about encoding the first time somebody's list
 * name contained an ampersand.
 *
 * Every request carries an explicit timeout. The original had only the job's
 * own abort signal, which nothing fired on its own, so a hung socket left the
 * run in `running` forever and blocked the whole queue behind it.
 */

import { httpRequestJson, HttpError } from "@rube/http";

const MDBLIST_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = "https://api.mdblist.com";

/** How many items one `/items` page asks for. MDBList's own cap. */
const ITEMS_PAGE_LIMIT = 1000;
/** Stop after this many pages, so a runaway list can't stall a run. */
const MAX_ITEM_PAGES = 20;

export type MdblistHealthCallback = (status: "ok" | "error", message: string) => void;

export interface MdblistClientOptions {
  /** Null is allowed so the client can be constructed before it is configured. */
  apiKey: string | null;
  onHealth?: MdblistHealthCallback;
  /** Overridden by tests pointing at the mock server. */
  baseUrl?: string;
}

/** A list as the search, top and metadata endpoints describe it. */
export interface MdblistListSummary {
  id: number;
  name: string;
  slug: string;
  owner: string;
  description: string;
  /** `movie` or `show`, per MDBList's own vocabulary. */
  mediaType: string;
  itemCount: number;
  likes: number;
}

/** One title in a list. Either id may be missing; both never are, in practice. */
export interface MdblistListItem {
  title: string;
  year: number | null;
  mediaType: "movie" | "show";
  imdbId: string | null;
  tmdbId: number | null;
}

interface RawListSummary {
  id?: number;
  name?: string;
  slug?: string;
  user_name?: string;
  description?: string;
  mediatype?: string;
  items?: number;
  likes?: number;
  error?: string;
}

interface RawListItem {
  id?: number;
  title?: string;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  release_year?: number | null;
  year?: number | null;
  mediatype?: string;
  ids?: { imdb?: string | null; tmdb?: number | null };
}

interface RawItemsPage {
  /** Returned as sibling arrays on the items endpoint. */
  movies?: RawListItem[];
  shows?: RawListItem[];
  error?: string;
}

/**
 * Resolve an MDBList list reference to its API path. Accepts either a
 * numeric list id (`12345`) or a `username/listname` slug (the share-URL
 * form). Each path segment is URL-encoded individually so a list name
 * containing spaces, `?`, `#`, or `&` can't break out into the query
 * string and inject parameters into the upstream request.
 */
export function mdblistListPath(idOrSlug: string): string {
  const trimmed = idOrSlug.trim();
  if (/^\d+$/.test(trimmed)) return `/lists/${encodeURIComponent(trimmed)}`;
  // Strip a leading https://mdblist.com/lists/ if a user pasted a URL.
  const slug = trimmed.replace(/^https?:\/\/(www\.)?mdblist\.com\/lists\//i, "").replace(/\/+$/, "");
  // Encode each segment independently so the `/` separator survives but
  // unsafe characters in the segments don't.
  const encoded = slug.split("/").map(encodeURIComponent).join("/");
  return `/lists/${encoded}`;
}

function toSummary(raw: RawListSummary): MdblistListSummary {
  return {
    id: raw.id ?? 0,
    name: raw.name?.trim() ?? "",
    slug: raw.slug ?? "",
    owner: raw.user_name ?? "",
    description: raw.description?.trim() ?? "",
    mediaType: raw.mediatype ?? "",
    itemCount: raw.items ?? 0,
    likes: raw.likes ?? 0,
  };
}

function toItem(raw: RawListItem, mediaType: "movie" | "show"): MdblistListItem {
  const imdbId = raw.ids?.imdb ?? raw.imdb_id ?? null;
  // `id` is the TMDb id on the items endpoint; `ids.tmdb` repeats it when
  // `append_to_response` is in play. Prefer the explicit one.
  const tmdbId = raw.ids?.tmdb ?? raw.tmdb_id ?? raw.id ?? null;
  return {
    title: raw.title?.trim() ?? "",
    year: raw.release_year ?? raw.year ?? null,
    mediaType,
    imdbId,
    tmdbId: typeof tmdbId === "number" ? tmdbId : null,
  };
}

export function createMdblistClient(opts: MdblistClientOptions) {
  const { apiKey, onHealth } = opts;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  function requireApiKey(): string {
    if (!apiKey) throw new Error("MDBList API key is not configured (Settings → Databases).");
    return apiKey;
  }

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const key = requireApiKey();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${sep}apikey=${encodeURIComponent(key)}`;
    let data: T & { error?: string };
    try {
      data = await httpRequestJson<T & { error?: string }>({
        url,
        init: { signal },
        timeoutMs: MDBLIST_TIMEOUT_MS,
        // Idempotent GET — retrying a transient 502 beats failing the nightly run.
        retries: 2,
      });
    } catch (err) {
      const detail = err instanceof HttpError ? String(err.status) : (err as Error).message;
      onHealth?.("error", `${path} → ${detail}`);
      throw err;
    }
    // MDBList answers 200 with an `error` field rather than a status code, so
    // an unreported failure here would look like an empty list.
    if (data && typeof data === "object" && data.error) {
      onHealth?.("error", `${path} → ${data.error}`);
      throw new Error(`MDBList: ${data.error}`);
    }
    onHealth?.("ok", `${path} → 200`);
    return data;
  }

  /** Search public lists by title. */
  async function searchLists(query: string, signal?: AbortSignal): Promise<MdblistListSummary[]> {
    const raw = await get<RawListSummary[]>(`/lists/search?query=${encodeURIComponent(query)}`, signal);
    return (Array.isArray(raw) ? raw : []).map(toSummary);
  }

  /** Public lists ordered by popularity — the browse state, before anyone types. */
  async function topLists(signal?: AbortSignal): Promise<MdblistListSummary[]> {
    const raw = await get<RawListSummary[]>("/lists/top", signal);
    return (Array.isArray(raw) ? raw : []).map(toSummary);
  }

  /**
   * A single list's metadata. MDBList answers with a one-element *array* here
   * rather than an object, which is easy to miss and yields `undefined` name.
   */
  async function getList(idOrSlug: string, signal?: AbortSignal): Promise<MdblistListSummary | null> {
    const raw = await get<RawListSummary[] | RawListSummary>(mdblistListPath(idOrSlug), signal);
    const first = Array.isArray(raw) ? raw[0] : raw;
    return first ? toSummary(first) : null;
  }

  /**
   * A list's titles, paged.
   *
   * `limit` bounds the whole walk rather than one request, because the only
   * two callers want either "the first screenful" (the Discover preview) or
   * "all of it" (the rule), and neither wants to do the paging itself.
   */
  async function getListItems(
    idOrSlug: string,
    opts: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<MdblistListItem[]> {
    const base = `${mdblistListPath(idOrSlug)}/items`;
    const ceiling = opts.limit ?? Infinity;
    const out: MdblistListItem[] = [];

    for (let page = 0; page < MAX_ITEM_PAGES && out.length < ceiling; page++) {
      opts.signal?.throwIfAborted();
      const want = Math.min(ITEMS_PAGE_LIMIT, ceiling - out.length);
      const data = await get<RawItemsPage>(`${base}?limit=${want}&offset=${page * ITEMS_PAGE_LIMIT}`, opts.signal);
      const movies = data.movies ?? [];
      const shows = data.shows ?? [];
      for (const m of movies) out.push(toItem(m, "movie"));
      for (const s of shows) out.push(toItem(s, "show"));
      // A short page is the last page.
      if (movies.length + shows.length < want) break;
    }

    return out.slice(0, ceiling === Infinity ? undefined : ceiling);
  }

  return { searchLists, topLists, getList, getListItems };
}

export type MdblistClient = ReturnType<typeof createMdblistClient>;
