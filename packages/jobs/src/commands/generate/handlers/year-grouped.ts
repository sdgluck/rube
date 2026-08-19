import { collectionLimit, describeLimits, filterGroups, minItemsPerGroup } from "#commands/generate/handlers/limits.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

export type YearGroupedField = "decades" | "years";

function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/**
 * Group items by Plex year. `decades` collapses to the decade bucket,
 * `years` keeps each year separate. Doesn't touch TMDb — Plex already
 * stores release year reliably for both movies and shows.
 */
export function yearGroupedHandler(field: YearGroupedField) {
  return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const maxCollections = collectionLimit(ruleConfig);
    const minItems = minItemsPerGroup(ruleConfig);

    for (const section of sections) {
      ctx.signal?.throwIfAborted();
      ctx.log(`[${field}] "${section.title}" — scanning items...`);

      type Group = {
        label: string;
        sortKey: number;
        items: Array<{ ratingKey: string; title: string; year?: number }>;
      };
      const groups = new Map<number, Group>();

      let total = 0;
      for await (const { item } of client.allItems(section.key)) {
        total++;
        if (typeof item.year !== "number" || item.year < 1880 || item.year > 2100) continue;
        const key = field === "decades" ? decadeOf(item.year) : item.year;
        const label = field === "decades" ? `${key}s` : `${key}`;
        const ratingKey = item.ratingKey ?? "";
        const title = item.title ?? "";
        if (!ratingKey) continue;

        const bucket = groups.get(key);
        const entry = { ratingKey, title, year: item.year };
        if (bucket) bucket.items.push(entry);
        else groups.set(key, { label, sortKey: key, items: [entry] });
      }

      const ranked = filterGroups([...groups.values()], ruleConfig, (g) => g.label)
        .filter((g) => g.items.length >= minItems)
        // Newest first — most users care about recent decades / years before
        // 1920s historicals.
        .sort((a, b) => b.sortKey - a.sortKey);

      ctx.log(
        `[${field}] "${section.title}" — ${total} items, ${groups.size} group(s), ${ranked.length} to build (${describeLimits(ruleConfig)}).`,
      );

      for (const group of ranked.slice(0, maxCollections)) {
        ctx.signal?.throwIfAborted();
        yield { name: group.label, section, matched: group.items };
      }
    }
  };
}
