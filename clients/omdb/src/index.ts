import { eq } from "drizzle-orm";
import { omdbCache, type Db } from "@rube/db";
import { httpRequest, HttpError } from "@rube/http";

export type OmdbHealthCallback = (status: "ok" | "error", message: string) => void;

export interface OmdbClientOptions {
  apiKey: string | null;
  onHealth?: OmdbHealthCallback;
  /** Lookups are cached in `omdb_cache`; this is the connection they land in. */
  db: Db;
}

export function extractImdbId(guids: string[]): string | null {
  for (const guid of guids) {
    const match = guid.match(/imdb:\/\/(tt\d+)/);
    if (match) return match[1];
  }
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * How long a lookup that may yet change stands before it is asked again.
 *
 * Two kinds of answer go stale. A missing Rotten Tomatoes score: caching the
 * absence for ever kept every film OMDb scored after its first lookup — every
 * new release — out of RT rules for good. And a recent release's awards line:
 * a film is looked up on release and wins its Oscar the following spring.
 * Re-asking everything every run would spend a free key's 1,000-a-day on
 * answers that cannot change, so an older title with a score stays cached.
 */
export const OMDB_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

/** Releases this many years old or newer can still pick up awards. */
const AWARDS_SETTLE_YEARS = 2;

export interface OmdbRatings {
  imdbRating: string | null;
  rtRating: string | null;
  /** OMDb's awards headline ("Won 7 Oscars. 23 wins & 18 nominations total"), or null. */
  awards: string | null;
  source: "cache" | "api";
}

function awardsLine(response: unknown): string | null {
  const value = (response as { Awards?: unknown } | null)?.Awards;
  return typeof value === "string" && value !== "N/A" ? value : null;
}

function isRecentRelease(response: unknown): boolean {
  const year = parseInt(String((response as { Year?: unknown } | null)?.Year ?? ""), 10);
  return Number.isFinite(year) && year >= new Date().getFullYear() - AWARDS_SETTLE_YEARS;
}

export function createOmdbClient(opts: OmdbClientOptions) {
  const { apiKey, onHealth, db } = opts;

  async function getRatings(imdbId: string): Promise<OmdbRatings | null> {
    const cached = db.select().from(omdbCache).where(eq(omdbCache.imdbId, imdbId)).get();
    const stale =
      cached &&
      Date.now() - cached.fetchedAt > OMDB_RECHECK_MS &&
      (cached.rtRating === null || isRecentRelease(cached.response));
    if (cached && (!stale || !apiKey)) {
      return {
        imdbRating: cached.imdbRating,
        rtRating: cached.rtRating,
        awards: awardsLine(cached.response),
        source: "cache",
      };
    }

    if (!apiKey) return null;

    // OMDb only supports key-as-query-param — no header alternative. We
    // construct the URL via `URL` (proper encoding) and route through the
    // shared http helper, which carries a 15s timeout and surfaces only
    // status codes on non-ok responses (never the URL).
    const url = new URL("https://www.omdbapi.com/");
    url.searchParams.set("i", imdbId);
    url.searchParams.set("apikey", apiKey);
    let res: Response;
    try {
      // Idempotent GET — see the note in clients/tmdb.
      res = await httpRequest({ url, timeoutMs: 10_000, retries: 2 });
    } catch (err) {
      if (err instanceof HttpError) {
        onHealth?.("error", `${err.status} ${err.message}`);
      } else {
        onHealth?.("error", errorMessage(err));
      }
      return null;
    }
    onHealth?.("ok", `GET /?i=${imdbId} → ${res.status}`);

    const data = await res.json();
    if (data.Response === "False") {
      // Answered 200, so the success above already went out. "Movie not found!"
      // is a fact about one title; anything else — "Request limit reached!",
      // "Invalid API key!" — fails every lookup after it, and reads as a
      // library with no ratings unless it lands somewhere a person looks.
      const error = typeof data.Error === "string" ? data.Error : "unknown error";
      if (!/not found/i.test(error)) onHealth?.("error", `OMDb: ${error}`);
      return null;
    }

    const imdbRating = data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
    let rtRating: string | null = null;

    if (Array.isArray(data.Ratings)) {
      const rt = data.Ratings.find((r: { Source: string; Value: string }) => r.Source === "Rotten Tomatoes");
      if (rt) rtRating = rt.Value;
    }

    const row = { imdbRating, rtRating, response: data, fetchedAt: Date.now() };
    db.insert(omdbCache)
      .values({ imdbId, ...row })
      .onConflictDoUpdate({ target: omdbCache.imdbId, set: row })
      .run();

    return { imdbRating, rtRating, awards: awardsLine(data), source: "api" };
  }

  return { getRatings };
}

export type OmdbClient = ReturnType<typeof createOmdbClient>;
