import { type Services } from "@rube/composition";

import { indexItemsByTmdb } from "#commands/generate/plex-index.ts";
import { minItemsPerGroup } from "#commands/generate/handlers/limits.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";
import { chunked, mapConcurrent } from "#jobs/concurrency.ts";

const MAX_PEOPLE = 50;
const DEFAULT_PEOPLE = 10;
/** Credits requests in flight per section. The TMDb client caps the rest. */
const CREDITS_CONCURRENCY = 6;

export function createTmdbPopularPeopleCommand(deps: Pick<Services, "config">) {
  const { config } = deps;
  const { getConfig } = config;

  /**
   * "Popular actors" / "Popular directors" — fetch the top N people from
   * TMDb, then for each person emit one collection per section listing the
   * library titles they appear in (cast) or directed (crew/Director).
   */
  function tmdbPopularPeopleHandler(role: "cast" | "crew") {
    return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
      const { ctx, client, sections, ruleConfig } = deps;
      const apiKey = getConfig("global_tmdb_api_key");
      if (!apiKey) throw new Error("TMDb API key is required. Configure it in Settings.");

      const { fetchPopularPeople, fetchPersonCredits } = await import("@rube/tmdb");
      // `limit` here is a TMDb fetch budget (how many popular people to pull),
      // not a collection cap — so it keeps its default rather than meaning
      // "unlimited" the way it does for library-grouped rules.
      const peopleLimit = Math.min(ruleConfig.limit ?? DEFAULT_PEOPLE, MAX_PEOPLE);
      const minItems = minItemsPerGroup(ruleConfig);
      const department = role === "cast" ? "Acting" : "Directing";
      const crewJob = role === "crew" ? "Director" : undefined;

      ctx.log(`[tmdb_popular] Fetching ${peopleLimit} popular ${department.toLowerCase()} people...`);
      const people = await fetchPopularPeople({ apiKey }, { limit: peopleLimit, department });
      ctx.log(`[tmdb_popular] Got ${people.length} people.`);

      for (const section of sections) {
        ctx.log(`[tmdb_popular] "${section.title}" — indexing by TMDb ID...`);
        const { items, tmdbToItem } = await indexItemsByTmdb(client, section.key);
        ctx.log(`[tmdb_popular] ${tmdbToItem.size}/${items.length} items have TMDb IDs in "${section.title}".`);

        const sectionMediaType: "movie" | "tv" = section.type === "show" ? "tv" : "movie";

        // A credits request per person, fetched a chunk at a time rather than
        // one at a time — but still a chunk at a time rather than all at once,
        // so the first collections reach Plex while the rest are still coming.
        for (const batch of chunked(people, CREDITS_CONCURRENCY)) {
          ctx.signal?.throwIfAborted();
          const fetched = await mapConcurrent(batch, CREDITS_CONCURRENCY, async (person) => ({
            person,
            credits: await fetchPersonCredits({ apiKey }, person.id, {
              role,
              crewJob,
              mediaTypes: [sectionMediaType],
            }),
          }));

          for (const { person, credits } of fetched) {
            const matched: Array<{ ratingKey: string; title: string; year?: number }> = [];
            const seen = new Set<string>();
            for (const credit of credits) {
              const item = tmdbToItem.get(credit.id);
              if (!item || seen.has(item.ratingKey)) continue;
              seen.add(item.ratingKey);
              matched.push(item);
            }

            if (matched.length < minItems) {
              ctx.log(`[tmdb_popular] Skipping "${person.name}" in "${section.title}" — ${matched.length} item(s).`);
              continue;
            }

            yield { name: person.name, section, matched };
          }
        }
      }
    };
  }

  return { tmdbPopularPeopleHandler };
}
