import { getConfig } from "@tinkerbell/core";
import { indexItemsByTmdb } from "#commands/generate/plex-index.ts";
import { lookupBelongsToCollection } from "#commands/generate/sources/tmdb.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

const MAX_GROUPS = 100;
const DEFAULT_GROUPS = 25;
const MIN_MEMBERS_TO_BUILD = 2;

/**
 * Build franchise collections (Marvel, Bond, etc.) from TMDb's "belongs to
 * collection" data. Strategy:
 *   1. Enumerate Plex's auto-detected collection-groups for the section
 *      (the secondary `collection` directory).
 *   2. Pick a sample movie from each group, look up its TMDb record, and
 *      read out the parent franchise ID.
 *   3. Fetch the full franchise from TMDb and intersect with the section.
 *
 * Why the indirection? Plex doesn't expose the TMDb collection ID itself,
 * but it already groups items into the same franchises Plex thinks they
 * belong to — sampling one item per group is cheap and reliable.
 */
export async function* tmdbFranchisesHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
  const { ctx, client, sections, ruleConfig } = deps;

  const apiKey = getConfig("global_tmdb_api_key");
  if (!apiKey) throw new Error("TMDb API key is required. Configure it in Settings.");

  const { fetchCollection } = await import("@tinkerbell/tmdb");
  const limitGroups = Math.min(ruleConfig.limit ?? DEFAULT_GROUPS, MAX_GROUPS);

  for (const section of sections) {
    if (section.type !== "movie") {
      ctx.log(`[tmdb_franchises] Skipping non-movie section "${section.title}".`);
      continue;
    }

    ctx.log(`[tmdb_franchises] "${section.title}" — fetching items with TMDb IDs...`);
    const { tmdbToItem } = await indexItemsByTmdb(client, section.key);
    const ratingKeyToTmdbId = new Map<string, number>();
    for (const [tmdbId, info] of tmdbToItem) {
      ratingKeyToTmdbId.set(info.ratingKey, tmdbId);
    }

    const groups = await client.fetchGroupedByField(section.key, "collection", limitGroups);
    ctx.log(`[tmdb_franchises] Found ${groups.length} Plex collection group(s) in "${section.title}".`);

    // Note: original behavior does NOT dedupe by franchise ID at the
    // handler level — that's only done in the arr resolver. Preserved here.
    for (const group of groups) {
      const groupItems = await client.fetchItemsByFilter(group.key);
      if (groupItems.length === 0) continue;

      const sampleTmdbId = groupItems
        .map((gi) => ratingKeyToTmdbId.get(gi.ratingKey))
        .find((id): id is number => id !== undefined);
      if (!sampleTmdbId) continue;

      const franchise = await lookupBelongsToCollection(apiKey, sampleTmdbId);
      if (!franchise) {
        ctx.log(`[tmdb_franchises] No TMDb collection for "${group.tag}", skipping.`);
        continue;
      }

      const tmdbCollection = await fetchCollection({ apiKey }, franchise.id);
      const matched: Array<{ ratingKey: string; title: string; year?: number }> = [];
      for (const part of tmdbCollection.parts) {
        const item = tmdbToItem.get(part.id);
        if (item) matched.push(item);
      }

      if (matched.length < MIN_MEMBERS_TO_BUILD) {
        ctx.log(`[tmdb_franchises] "${franchise.name}" — only ${matched.length} match(es), skipping.`);
        continue;
      }

      ctx.log(`[tmdb_franchises] Yielding "${franchise.name}" (${matched.length}/${tmdbCollection.parts.length})...`);
      yield { name: franchise.name, section, matched };
    }
  }
}
