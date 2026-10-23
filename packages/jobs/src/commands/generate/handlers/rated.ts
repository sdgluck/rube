import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

/**
 * "Top Rated" / "Lowest Rated" — produces one collection per section,
 * containing the N items sorted by Plex's rating field. The sort direction
 * comes from the rule type: `top_rated` → desc, `lowest_rated` → asc.
 */
export function ratedHandler(direction: "top" | "lowest") {
  return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const sort = direction === "top" ? "rating:desc" : "rating:asc";
    const displayName = direction === "top" ? "Top Rated" : "Lowest Rated";
    const limit = ruleConfig.limit ?? 50;

    for (const section of sections) {
      ctx.log(`[${displayName}] "${section.title}" — fetching top ${limit} items sorted by ${sort}...`);

      // Trimmed here too: the limit is the rule's whole promise, and Plex has
      // already once answered a paged request with the entire section.
      const items = (await client.fetchItemsSorted(section.key, sort, limit)).slice(0, limit);
      if (items.length === 0) {
        ctx.log(`No items found, skipping.`);
        continue;
      }

      yield {
        name: `${displayName} in ${section.title}`,
        section,
        matched: items.map((i) => ({ ratingKey: i.ratingKey, title: i.title, year: i.year })),
      };
    }
  };
}
