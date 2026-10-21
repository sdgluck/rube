/**
 * The Plex Watchlist, which does not live on the media server.
 *
 * It is an account-level list held by plex.tv's metadata service, so none of
 * `PlexHttp` applies: that client is built around `global_plex_url` and every
 * path it knows is a path on the user's own server. `auth.ts` already
 * establishes the shape for plex.tv calls — plain functions taking a token
 * explicitly, rather than members of the server client factory — and this
 * follows it.
 *
 * Two things about the API are worth stating because both are easy to get
 * wrong from the outside:
 *
 * - **The list is paged and lies about it by omission.** There is no "next"
 *   link and no explicit end marker; a caller that asks for one page gets one
 *   page and no indication there are more. Paging terminates on a short page,
 *   with `totalSize` used only as a sanity bound.
 * - **Removal is a `PUT`, not a `DELETE`,** and it is keyed by `ratingKey`
 *   rather than by the `guid` everything else here is keyed on. The two are
 *   related but not interchangeable, so the rating key is returned alongside
 *   the guid and stored — an item cannot be removed from a guid alone.
 */
import { httpRequest, httpRequestJson, HttpError } from "@rube/http";

const METADATA_PROVIDER = "https://metadata.provider.plex.tv";

/** Items per request. Plex caps the container well above this; 100 is polite. */
const PAGE_SIZE = 100;

/**
 * Hard stop on paging, in pages rather than items.
 *
 * A watchlist is a human-curated list — thousands is already implausible — and
 * the failure this guards is not a large list but a server that ignores
 * `X-Plex-Container-Start` and returns page one forever.
 */
const MAX_PAGES = 100;

export interface WatchlistEntry {
  /** `plex://movie/5d776b…`. The stable identity, and our primary key. */
  guid: string;
  /** What `removeFromWatchlist` takes. Not derivable from `guid`. */
  ratingKey: string;
  title: string;
  /** "movie" | "show". Plex uses "show", not "tv". */
  type: string;
  year?: number;
  /** When the user added it, in **seconds** — Plex's unit, left as Plex's. */
  addedAt?: number;
  /** `imdb://tt0133093`, `tmdb://603`, `tvdb://1234` — provider ids. */
  guids: string[];
}

interface MetadataRow {
  guid?: string;
  ratingKey?: string;
  title?: string;
  type?: string;
  year?: number;
  addedAt?: number;
  Guid?: Array<{ id?: string }>;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "rube",
    "X-Plex-Product": "Rube",
  };
}

function toEntry(row: MetadataRow): WatchlistEntry | null {
  // An entry without a guid cannot be diffed against the ledger and cannot be
  // removed, so it is dropped rather than stored under an empty key — which
  // would collide with the next such row and look like the same item.
  if (!row.guid) return null;
  return {
    guid: row.guid,
    ratingKey: row.ratingKey ?? "",
    title: row.title ?? "",
    type: row.type ?? "",
    year: row.year,
    addedAt: row.addedAt,
    guids: (row.Guid ?? []).map((g) => g.id).filter((id): id is string => !!id),
  };
}

export interface FetchWatchlistOptions {
  signal?: AbortSignal;
  /** Reports reachability under the same service name `plextv.ts` uses. */
  onHealth?: (service: string, status: "ok" | "error", message: string) => void;
}

/**
 * The whole watchlist for the account behind `token`, newest addition first.
 *
 * Fetched in full rather than incrementally: the list carries no cursor and no
 * "changed since", and it is the *absences* that matter as much as the
 * presences — an item the caller has a row for that is no longer here has been
 * removed, which cannot be observed from a page of recent additions.
 */
export async function fetchWatchlist(token: string, opts: FetchWatchlistOptions = {}): Promise<WatchlistEntry[]> {
  const out: WatchlistEntry[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL("/library/sections/watchlist/all", METADATA_PROVIDER);
    url.searchParams.set("X-Plex-Container-Start", String(page * PAGE_SIZE));
    url.searchParams.set("X-Plex-Container-Size", String(PAGE_SIZE));
    // Without this the provider ids are omitted, and a provider id is the only
    // thing an *Arr can be asked about — the `plex://` guid means nothing to it.
    url.searchParams.set("includeGuids", "1");
    url.searchParams.set("includeCollections", "0");
    url.searchParams.set("includeExternalMedia", "1");

    let data: { MediaContainer?: { Metadata?: MetadataRow[] } };
    try {
      data = await httpRequestJson({
        url,
        retries: 2,
        timeoutMs: 20_000,
        init: { method: "GET", headers: headers(token), signal: opts.signal },
      });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : err instanceof Error ? err.message : String(err);
      opts.onHealth?.("Plex.tv", "error", `GET /library/sections/watchlist/all → ${message}`);
      throw err;
    }

    const rows = data?.MediaContainer?.Metadata ?? [];
    for (const row of rows) {
      const entry = toEntry(row);
      // De-duplicated across pages as well as within one: a list edited while
      // it is being walked shifts every item after the edit, which shows the
      // same row on two consecutive pages.
      if (entry && !seen.has(entry.guid)) {
        seen.add(entry.guid);
        out.push(entry);
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  opts.onHealth?.("Plex.tv", "ok", `GET /library/sections/watchlist/all → ${out.length} item(s)`);
  return out;
}

/**
 * Take an item off the account's watchlist.
 *
 * This mutates the user's own Plex account, which is why every caller of it is
 * behind a setting that defaults to off. Not retried: the endpoint answers 200
 * with an empty body and is idempotent in principle, but a re-send after a
 * lost response is a second write to somebody's personal list to save one
 * failed attempt that the next run would retry anyway.
 */
export async function removeFromWatchlist(
  token: string,
  ratingKey: string,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const url = new URL("/actions/removeFromWatchlist", METADATA_PROVIDER);
  url.searchParams.set("ratingKey", ratingKey);
  await httpRequest({
    url,
    retries: 0,
    timeoutMs: 15_000,
    init: { method: "PUT", headers: headers(token), signal: opts.signal },
  });
}
