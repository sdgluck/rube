import type { Services } from "@rube/composition";
import { perDeps } from "@rube/container";
/**
 * Per-server tag keys as titles, for the summaries written during a run.
 *
 * A smart filter stores `genre = "1204"` whenever it was imported from a Plex
 * filter URI, and only Plex knows that 1204 is Horror. Without the lookup a
 * collection's description reads "Films where genre is 1204", which is the
 * kind of thing you only ship once.
 *
 * Two things keep this cheap. The lookup only runs for values that are bare
 * numbers — a rule authored in Rube stores titles already, so the
 * common case makes no request at all. And the per-section maps are cached
 * across the run, because a grouped rule commits hundreds of collections and
 * every one of them would otherwise re-ask for the same genre list.
 */
import { needsTagLookup, type TagResolver } from "@rube/contracts";
import { fieldDef } from "@rube/contracts";
import type { PlexClient } from "@rube/plex";
import type { SmartFilterNode } from "@rube/plex-smart-filter";

/**
 * Long enough that one generate run makes a single request per field, short
 * enough that retagging a library shows up in the next run rather than at the
 * next restart — the server process is long-lived.
 */
const TTL_MS = 5 * 60_000;

interface Entry {
  at: number;
  map: Promise<Map<string, string>>;
}

/** Every tag field in the tree whose value is a key we'd have to look up. */
function unresolvedTagFields(node: SmartFilterNode, out = new Set<string>()): Set<string> {
  if (node.kind === "leaf") {
    if (needsTagLookup(node.field, node.value)) out.add(fieldDef(node.field)?.field ?? node.field);
    return out;
  }
  for (const child of node.children) unresolvedTagFields(child, out);
  return out;
}

export const createTagLabels = perDeps(function createTagLabels(_deps: Services) {
  const cache = new Map<string, Entry>();

  /** Exported for tests, which would otherwise inherit each other's fixtures. */
  function clearTagLabelCache(): void {
    cache.clear();
  }

  function fetchField(client: PlexClient, sectionId: string, field: string): Promise<Map<string, string>> {
    const cacheKey = `${sectionId}\u0000${field}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

    const map = client
      .getFilterFieldValues(sectionId, field)
      .then((values) => new Map(values.map((v) => [v.key, v.title])))
      // A facet Plex doesn't expose for this section type 404s. The summary
      // falls back to the raw key, which is what it did before this existed.
      .catch(() => new Map<string, string>());

    cache.set(cacheKey, { at: Date.now(), map });
    return map;
  }

  /**
   * A resolver for this filter's tag keys, or undefined when it has none to
   * resolve — which is every rule authored in Rube, since those store
   * titles. Anything the lookup can't translate is returned untouched.
   */
  async function tagResolverFor(
    client: PlexClient,
    sectionId: string,
    filter: SmartFilterNode | undefined,
  ): Promise<TagResolver | undefined> {
    if (!filter) return undefined;
    const fields = [...unresolvedTagFields(filter)];
    if (fields.length === 0) return undefined;

    const maps = new Map<string, Map<string, string>>();
    await Promise.all(
      fields.map(async (field) => {
        maps.set(field, await fetchField(client, sectionId, field));
      }),
    );

    return (field, value) => maps.get(fieldDef(field)?.field ?? field)?.get(value.trim()) ?? value;
  }

  return { clearTagLabelCache, tagResolverFor };
});
