/**
 * Plex GUID extraction.
 *
 * Plex hangs several provider ids off an item (`tmdb://603`, `imdb://tt0133093`,
 * `tvdb://1234`), and matching a Plex item to an *Arr record goes through them —
 * titles and years are not reliable enough to delete a file on.
 *
 * These three regexes were written out longhand in four places in `arr.ts`
 * before this module existed, which is three chances to fix a bug in one of
 * them and miss the rest.
 */

const TMDB = /tmdb:\/\/(\d+)/;
const IMDB = /imdb:\/\/(tt\d+)/;
const TVDB = /tvdb:\/\/(\d+)/;

export interface ItemGuids {
  guids: string[];
}

export function tmdbId(item: ItemGuids): number | null {
  for (const guid of item.guids) {
    const m = guid.match(TMDB);
    if (m) return Number(m[1]);
  }
  return null;
}

export function imdbId(item: ItemGuids): string | null {
  for (const guid of item.guids) {
    const m = guid.match(IMDB);
    if (m) return m[1];
  }
  return null;
}

export function tvdbId(item: ItemGuids): number | null {
  for (const guid of item.guids) {
    const m = guid.match(TVDB);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * The external id to hand an *Arr client, in the form each one indexes on:
 * Radarr by TMDb, Sonarr by TVDb. Falls back to IMDb, which both accept, and
 * returns null when the item carries nothing usable — an unmatched item in
 * Plex, which must never be resolved by title.
 */
export function arrExternalId(item: ItemGuids, service: "radarr" | "sonarr"): string | null {
  if (service === "radarr") {
    const tmdb = tmdbId(item);
    if (tmdb != null) return `tmdb:${tmdb}`;
  } else {
    const tvdb = tvdbId(item);
    if (tvdb != null) return `tvdb:${tvdb}`;
  }
  const imdb = imdbId(item);
  return imdb ? `imdb:${imdb}` : null;
}
