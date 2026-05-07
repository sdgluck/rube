import { eq } from "drizzle-orm";
import { db, omdbCache } from "@tinkerbell/db";
import { httpRequest, HttpError } from "@tinkerbell/http";

export type OmdbHealthCallback = (status: "ok" | "error", message: string) => void;

export interface OmdbClientOptions {
  apiKey: string | null;
  onHealth?: OmdbHealthCallback;
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

export function createOmdbClient(opts: OmdbClientOptions) {
  const { apiKey, onHealth } = opts;

  async function getRatings(
    imdbId: string,
  ): Promise<{ imdbRating: string | null; rtRating: string | null; source: "cache" | "api" } | null> {
    const cached = db.select().from(omdbCache).where(eq(omdbCache.imdbId, imdbId)).get();
    if (cached) {
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
      res = await httpRequest({ url, timeoutMs: 10_000 });
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
    if (data.Response === "False") return null;

    const imdbRating = data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
    let rtRating: string | null = null;

    if (Array.isArray(data.Ratings)) {
      const rt = data.Ratings.find((r: { Source: string; Value: string }) => r.Source === "Rotten Tomatoes");
      if (rt) rtRating = rt.Value;
    }

    db.insert(omdbCache)
      .values({
        imdbId,
        imdbRating,
        rtRating,
        response: data,
        fetchedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();

    return { imdbRating, rtRating, source: "api" };
  }

  return { getRatings };
}

export type OmdbClient = ReturnType<typeof createOmdbClient>;
