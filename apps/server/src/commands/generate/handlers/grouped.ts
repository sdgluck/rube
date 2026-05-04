import type { HandlerDeps, PendingCollection } from "../types.ts";

const MIN_ITEMS_PER_GROUP = 3;

/**
 * "By field" handlers (actors, directors, studios, networks, genres,
 * countries, content_ratings). Each Plex tag in the field becomes a
 * candidate collection; we drop any with fewer than 3 items.
 */
export function groupedHandler(field: string) {
  return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const maxCollections = ruleConfig.limit ?? 10;

    for (const section of sections) {
      ctx.log(`[${field}] "${section.title}" — fetching top ${maxCollections} ${field}s...`);

      const entries = await client.fetchGroupedByField(section.key, field, maxCollections);
      if (entries.length === 0) {
        ctx.log(`No ${field} entries found, skipping.`);
        continue;
      }

      for (const entry of entries) {
        const items = await client.fetchItemsByFilter(entry.key);
        if (items.length < MIN_ITEMS_PER_GROUP) {
          ctx.log(`Skipping "${entry.tag}" — only ${items.length} item(s), need at least ${MIN_ITEMS_PER_GROUP}`);
          continue;
        }

        yield {
          name: entry.tag,
          section,
          matched: items.map((i) => ({ ratingKey: i.ratingKey, title: i.title, year: i.year })),
        };
      }
    }
  };
}
