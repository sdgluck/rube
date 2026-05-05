import type { CollectionInput } from "../types.ts";

const KOMETA_LABELS = ["Kometa", "PMM"] as const;

function labelMatches(label: string): boolean {
  const trimmed = label.trim();
  return KOMETA_LABELS.some((k) => trimmed.toLowerCase() === k.toLowerCase());
}

/**
 * Single-row claim check — does this collection look Kometa-managed?
 * Exposed so other providers (e.g. Plex Smart) can ask "is this yours?"
 * without round-tripping a list through `detectKometa`.
 */
export function isKometaClaimed(c: CollectionInput): boolean {
  return c.labels.some(labelMatches);
}

/**
 * Return only the collections that look Kometa-managed. We rely solely on
 * the "Kometa" / "PMM" label — sort_title prefixes were considered but
 * users rename collections post-creation often enough that they're noisy.
 */
export function detectKometa(collections: CollectionInput[]): CollectionInput[] {
  return collections.filter(isKometaClaimed);
}
