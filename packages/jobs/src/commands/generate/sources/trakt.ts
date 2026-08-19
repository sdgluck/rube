import { type Services } from "@tinkerbell/composition";

import { httpRequestJson } from "@tinkerbell/http";

/**
 * Trakt lists.
 *
 * Scope note, because it's the first question anyone asks: this reads *public*
 * lists, authenticated with nothing but a client id. That is deliberate, and
 * it is not the same as "Trakt support is half-finished".
 *
 * Trakt's API splits cleanly. Public lists — `trakt_list`, `trakt_userlist`,
 * the official charts — need only an API key, which an admin pastes once.
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
 */
const TRAKT_TIMEOUT_MS = 20_000;
const TRAKT_API = "https://api.trakt.tv";

/** One page of list items; Trakt caps at 1000 per page. */
const PAGE_LIMIT = 1000;
/** Stop after this many pages, so a runaway list can't stall a run. */
const MAX_PAGES = 10;

interface TraktIds {
  imdb?: string | null;
  tmdb?: number | null;
}

interface TraktListItem {
  movie?: { ids?: TraktIds };
  show?: { ids?: TraktIds };
}

interface TraktList {
  name?: string;
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

export function createTraktCommand(deps: Pick<Services, "config">) {
  const { getConfig } = deps.config;

  function requireClientId(): string {
    const clientId = getConfig("global_trakt_client_id");
    if (!clientId) throw new Error("Trakt API key is not configured (Settings → Databases).");
    return clientId;
  }

  async function traktFetch<T>(path: string, signal: AbortSignal | undefined, clientId: string): Promise<T> {
    return httpRequestJson<T>({
      url: `${TRAKT_API}${path}`,
      init: {
        signal,
        headers: {
          "Content-Type": "application/json",
          "trakt-api-version": "2",
          "trakt-api-key": clientId,
        },
      },
      timeoutMs: TRAKT_TIMEOUT_MS,
      // Idempotent GET — retrying a transient 502 beats failing the run.
      retries: 2,
    });
  }

  /**
   * Fetch a list's name and every id in it.
   *
   * Paged rather than trusting one request to hold the lot: Trakt caps a page
   * at 1000, and "Top 5000 Movies of All Time" is exactly the kind of list
   * people put in a Kometa config.
   */
  async function fetchTraktList(
    reference: string,
    signal?: AbortSignal,
  ): Promise<{ name: string; imdbIds: string[]; tmdbIds: number[] }> {
    const clientId = requireClientId();
    const base = traktListPath(reference);

    let meta: TraktList;
    try {
      meta = await traktFetch<TraktList>(base, signal, clientId);
    } catch (err) {
      const message = (err as Error).message ?? "";
      // Trakt answers 401/403 for both "bad key" and "this list isn't public",
      // and the difference is the whole fix — so say which one is likelier.
      if (/\b401\b|\b403\b/.test(message)) {
        throw new Error(
          `Trakt refused access to "${reference}". Private lists, watchlists and personal collections need a Trakt sign-in, which isn't supported yet — check the list is public.`,
        );
      }
      if (/\b404\b/.test(message)) throw new Error(`Trakt list "${reference}" doesn't exist (or is no longer public).`);
      throw err;
    }

    const imdbIds: string[] = [];
    const tmdbIds: number[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      signal?.throwIfAborted();
      const items = await traktFetch<TraktListItem[]>(
        `${base}/items?page=${page}&limit=${PAGE_LIMIT}`,
        signal,
        clientId,
      );
      if (!Array.isArray(items) || items.length === 0) break;

      for (const entry of items) {
        const ids = entry.movie?.ids ?? entry.show?.ids;
        if (!ids) continue;
        if (ids.imdb) imdbIds.push(ids.imdb);
        if (typeof ids.tmdb === "number") tmdbIds.push(ids.tmdb);
      }

      // A short page is the last page.
      if (items.length < PAGE_LIMIT) break;
    }

    return { name: meta.name?.trim() || reference, imdbIds, tmdbIds };
  }

  return { fetchTraktList };
}
