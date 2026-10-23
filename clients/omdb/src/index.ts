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
 * How long "OMDb has no Rotten Tomatoes score for this" stands before it is
 * asked again. Caching the absence for ever meant a film OMDb scored after
 * its first lookup — every new release — stayed out of RT rules for good;
 * re-asking every run would spend a free key's 1,000-a-day on the same
 * unscored titles. A present score is still cached for ever.
 */
export const MISSING_RT_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

export function createOmdbClient(opts: OmdbClientOptions) {
  const { apiKey, onHealth, db } = opts;

  async function getRatings(
    imdbId: string,
  ): Promise<{ imdbRating: string | null; rtRating: string | null; source: "cache" | "api" } | null> {
    const cached = db.select().from(omdbCache).where(eq(omdbCache.imdbId, imdbId)).get();
    const stale = cached && cached.rtRating === null && Date.now() - cached.fetchedAt > MISSING_RT_RECHECK_MS;
    if (cached && (!stale || !apiKey)) {
      return { imdbRating: cached.imdbRating, rtRating: cached.rtRating, source: "cache" };
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

    return { imdbRating, rtRating, source: "api" };
  }

  return { getRatings };
}

export type OmdbClient = ReturnType<typeof createOmdbClient>;
