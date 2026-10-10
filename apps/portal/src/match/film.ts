import { apiUrl } from "@tinkerbell/native-client";

/** A poster's signed path, made absolute in the native app, where the server is another origin. */
export function posterSrc(path: string | null): string | null {
  return path ? apiUrl(path) : null;
}

export function runtime(ms: number | null): string | null {
  if (!ms) return null;
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** "1999 · 7.8 · 2h 16m · R", skipping whatever the library doesn't know. */
export function filmMeta(film: {
  year: number | null;
  rating: number | null;
  durationMs: number | null;
  contentRating: string | null;
}): string {
  return [film.year, film.rating ? film.rating.toFixed(1) : null, runtime(film.durationMs), film.contentRating]
    .filter(Boolean)
    .join(" · ");
}

export function plexLink(serverId: string, ratingKey: string): string {
  return `https://app.plex.tv/desktop/#!/server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
}
