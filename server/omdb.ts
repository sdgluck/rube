import { eq } from "drizzle-orm";
import { db } from "./db/index.ts";
import { omdbCache } from "./db/schema.ts";
import { getConfig } from "./config.ts";

export function extractImdbId(guids: string[]): string | null {
  for (const guid of guids) {
    const match = guid.match(/imdb:\/\/(tt\d+)/);
    if (match) return match[1];
  }
  return null;
}

export async function getOmdbRatings(
  imdbId: string,
): Promise<{ imdbRating: string | null; rtRating: string | null } | null> {
  // Check cache first
  const cached = db.select().from(omdbCache).where(eq(omdbCache.imdbId, imdbId)).get();
  if (cached) {
    return { imdbRating: cached.imdbRating, rtRating: cached.rtRating };
  }

  const apiKey = getConfig("global_omdb_api_key");
  if (!apiKey) return null;

  const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.Response === "False") return null;

  const imdbRating = data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null;
  let rtRating: string | null = null;

  if (Array.isArray(data.Ratings)) {
    const rt = data.Ratings.find((r: { Source: string; Value: string }) => r.Source === "Rotten Tomatoes");
    if (rt) rtRating = rt.Value;
  }

  // Cache the result
  db.insert(omdbCache)
    .values({
      imdbId,
      imdbRating,
      rtRating,
      response: JSON.stringify(data),
      fetchedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  return { imdbRating, rtRating };
}
