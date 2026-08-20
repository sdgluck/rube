/**
 * `tmdb:603` / `imdb:tt0133093` / `tvdb:1234` — the vocabulary Tinkerbell uses
 * to name a title across services.
 *
 * The same strings `packages/core/src/guids.ts` produces from Plex GUIDs and
 * `watchlist_items.externalId` stores. Parsing lives here because the clients
 * cannot import from `core` (core depends on clients, which would be a cycle),
 * and both ends must agree on the spelling or the join silently finds nothing.
 */

export type ExternalScheme = "tmdb" | "imdb" | "tvdb";

export interface ExternalId {
  scheme: ExternalScheme;
  value: string;
}

export function parseExternalId(externalId: string): ExternalId | null {
  const idx = externalId.indexOf(":");
  if (idx <= 0) return null;
  const scheme = externalId.slice(0, idx);
  const value = externalId.slice(idx + 1);
  if (!value) return null;
  if (scheme !== "tmdb" && scheme !== "imdb" && scheme !== "tvdb") return null;
  return { scheme, value };
}

export function formatExternalId(scheme: ExternalScheme, value: string | number): string {
  return `${scheme}:${value}`;
}
