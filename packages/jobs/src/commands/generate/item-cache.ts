import type { PlexClient } from "@tinkerbell/plex";

/**
 * Wrap a Plex client so the full-library walks are fetched once per section
 * per job run instead of once per rule.
 *
 * `allItemsWithGuids` and `fetchAllItems` page through an entire section —
 * on a 4,000-item library that's the single most expensive thing a rule
 * does, and a 34-rule batch used to repeat it dozens of times over a library
 * that cannot change mid-run. `arr.ts` alone calls it up to four more times
 * per rule.
 *
 * Promises are cached, not results, so rules running concurrently share one
 * in-flight walk rather than starting a second. A rejected walk is evicted
 * so the next rule retries rather than inheriting the failure.
 *
 * The cached arrays are shared by reference: callers must treat them as
 * read-only (every current one iterates and builds its own structures).
 */
export function withItemCache(client: PlexClient): PlexClient {
  return {
    ...client,
    allItemsWithGuids: memoizeBySection(client.allItemsWithGuids),
    fetchAllItems: memoizeBySection(client.fetchAllItems),
  };
}

// `walk`, not `fetch`: shadowing the global trips `scripts/check-fetch.mjs`,
// which reads `fetch(…)` here as an un-deadlined HTTP call.
function memoizeBySection<T>(walk: (sectionId: string) => Promise<T>): (sectionId: string) => Promise<T> {
  const bySection = new Map<string, Promise<T>>();
  return (sectionId: string) => {
    const hit = bySection.get(sectionId);
    if (hit) return hit;
    const pending = walk(sectionId).catch((err: unknown) => {
      bySection.delete(sectionId);
      throw err;
    });
    bySection.set(sectionId, pending);
    return pending;
  };
}
