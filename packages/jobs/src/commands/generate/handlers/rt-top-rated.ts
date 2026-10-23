import { type Services } from "@rube/composition";
import PQueue from "p-queue";
import { extractImdbId } from "@rube/omdb";

import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

const OMDB_CONCURRENCY = 5;
const PROGRESS_INTERVAL = 50;
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

      const scored: Array<{ ratingKey: string; title: string; year?: number; score: number }> = [];
      const queue = new PQueue({ concurrency: OMDB_CONCURRENCY });
      if (ctx.signal) {
        ctx.signal.addEventListener("abort", () => queue.clear(), { once: true });
      }

      let processed = 0;
      let apiCalls = 0;
      let cacheHits = 0;
      let unanswered = 0;
      for (const item of items) {
        const imdbId = extractImdbId(item.guids);
        if (!imdbId) continue;

        void queue.add(async () => {
          ctx.signal?.throwIfAborted();
          const ratings = await getOmdbClient().getRatings(imdbId);
          processed++;
          if (!ratings) unanswered++;
          else if (ratings.source === "cache") cacheHits++;
          else apiCalls++;
          if (processed % PROGRESS_INTERVAL === 0) {
            ctx.log(`OMDB progress: ${processed} processed (${cacheHits} cached, ${apiCalls} fetched)...`);
          }
          if (!ratings?.rtRating) return;
          const scoreMatch = ratings.rtRating.match(/(\d+)%/);
          if (!scoreMatch) return;
          scored.push({
            ratingKey: item.ratingKey,
            title: item.title,
            year: item.year,
            score: parseInt(scoreMatch[1], 10),
          });
        });
      }

      await queue.onIdle();
      ctx.signal?.throwIfAborted();
      ctx.log(
        `Processed ${processed} item(s) (${cacheHits} from cache, ${apiCalls} fetched from OMDB), ${scored.length} have RT scores.`,
      );
      // A null is OMDb not knowing the title, a failed request, or the key's
      // daily limit — and the last one empties every lookup after it. Counted
      // apart from "no RT score", or a quota run looks like an unrated library.
      if (unanswered > 0) {
        ctx.log(
          `${unanswered} lookup(s) got no answer from OMDB (unknown title, failed request or request limit) — see Health for the reason.`,
        );
      }

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
