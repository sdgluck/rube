import { errorMessage } from "#lib/util.ts";

/**
 * TMDb exposes a movie's parent collection (franchise) on the /movie/{id}
 * endpoint as `belongs_to_collection`. We sample one movie from a Plex
 * collection-group, look it up, and read out the franchise ID + name.
 *
 * Returns null on any miss (network failure, no parent collection, etc.) —
 * callers should skip the group rather than fail the run.
 */
export async function lookupBelongsToCollection(
  apiKey: string,
  movieTmdbId: number,
): Promise<{ id: number; name: string } | null> {
  try {
    const url = `https://api.themoviedb.org/3/movie/${movieTmdbId}?api_key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { belongs_to_collection?: { id: number; name: string } | null };
    return data.belongs_to_collection ?? null;
  } catch (err) {
    // Caller logs as needed — we just signal "no franchise here".
    void errorMessage(err);
    return null;
  }
}
