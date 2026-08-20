/**
 * The vocabulary Discover needs on both sides.
 *
 * Separate from `arr.ts` because Discover's subject is not an *Arr: it is a
 * TMDb search result that may or may not become one. The two meet only at the
 * add dialog.
 */

import type { ArrService } from "./arr.ts";

/**
 * TMDb's image CDN.
 *
 * The browser builds poster URLs itself rather than the server sending
 * absolute ones, for the same reason the mirror stores a provider CDN URL and
 * never the *Arr's own `/MediaCover/…` path: nothing that needs a key to fetch
 * may reach the client, and the *size* belongs to whoever is rendering.
 */
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type TmdbPosterSize = "w154" | "w342" | "w500";

export function tmdbPosterUrl(path: string | null | undefined, size: TmdbPosterSize = "w342"): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

/** Which *Arr a search result would go to. There is no third answer. */
export function serviceForMediaType(mediaType: "movie" | "tv"): ArrService {
  return mediaType === "movie" ? "radarr" : "sonarr";
}
