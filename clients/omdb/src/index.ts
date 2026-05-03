import { eq } from "drizzle-orm";
import { db, omdbCache } from "@tinkerbell/db";

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

  async function getRatings(imdbId: string): Promise<{ imdbRating: string | null; rtRating: string | null } | null> {
    const cached = db.select().from(omdbCache).where(eq(omdbCache.imdbId, imdbId)).get();
    if (cached) {
      return { imdbRating: cached.imdbRating, rtRating: cached.rtRating };
    }

    if (!apiKey) return null;

    let res: Response;
    try {
      res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`);
    } catch (err) {
      onHealth?.("error", errorMessage(err));
      return null;
    }
    if (!res.ok) {
      onHealth?.("error", `${res.status} ${res.statusText}`);
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

    return { imdbRating, rtRating };
  }

  return { getRatings };
}

export type OmdbClient = ReturnType<typeof createOmdbClient>;
