import type { CollectionInput } from "../types.ts";

const KOMETA_LABELS = ["Kometa", "PMM"] as const;

function labelMatches(label: string): boolean {
  const trimmed = label.trim();
  return KOMETA_LABELS.some((k) => trimmed.toLowerCase() === k.toLowerCase());
}

/**
 * Return only the collections that look Kometa-managed. We rely solely on
 * the "Kometa" / "PMM" label — sort_title prefixes were considered but
 * users rename collections post-creation often enough that they're noisy.
 */
export function detectKometa(collections: CollectionInput[]): CollectionInput[] {
  return collections.filter((c) => c.labels.some(labelMatches));
}
