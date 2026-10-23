import { type Services } from "@rube/composition";

import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";
import { scanOmdb } from "./omdb-scan.ts";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export function createRtTopRatedCommand(deps: Pick<Services, "clients" | "config">) {
  const { clients, config } = deps;
  const { getOmdbClient } = clients;
  const { getConfig } = config;

  /**
   * Walk every item with an IMDb GUID, ask OMDB for its Rotten Tomatoes score,
   * sort by score, and emit the top N as a single collection per section.
   */
  async function* rtTopRatedHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;

    if (!getConfig("global_omdb_api_key")) {
      throw new Error("OMDB API key is required for RT Top Rated rules. Configure it in Settings.");
    }

    const limit = Math.min(ruleConfig.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    for (const section of sections) {
      ctx.log(`[RT Top Rated] "${section.title}" — fetching all items with GUIDs...`);
      const items = await client.allItemsWithGuids(section.key);
      ctx.log(`Found ${items.length} item(s). Fetching Rotten Tomatoes scores via OMDB...`);

      const { answered, processed, cacheHits, apiCalls } = await scanOmdb(ctx, getOmdbClient, items);
      const scored: Array<{ ratingKey: string; title: string; year?: number; score: number }> = [];
      for (const { item, ratings } of answered) {
        const scoreMatch = ratings.rtRating?.match(/(\d+)%/);
        if (!scoreMatch) continue;
        scored.push({
          ratingKey: item.ratingKey,
          title: item.title,
          year: item.year,
          score: parseInt(scoreMatch[1], 10),
        });
      }
      ctx.log(
        `Processed ${processed} item(s) (${cacheHits} from cache, ${apiCalls} fetched from OMDB), ${scored.length} have RT scores.`,
      );

      if (scored.length === 0) {
        ctx.log(`No items with RT scores in "${section.title}", skipping.`);
        continue;
      }

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit);

      yield {
        name: `Rotten Tomatoes Top ${limit} in ${section.title}`,
        section,
        matched: top.map(({ ratingKey, title, year }) => ({ ratingKey, title, year })),
      };
    }
  }

  return { rtTopRatedHandler };
}
