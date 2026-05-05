import { getConfig } from "#lib/config.ts";
import { indexItemsByTmdb } from "#commands/generate/plex-index.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

const MAX_PEOPLE = 50;
const DEFAULT_PEOPLE = 10;
const MIN_ITEMS_PER_PERSON = 3;

/**
 * "Popular actors" / "Popular directors" — fetch the top N people from
 * TMDb, then for each person emit one collection per section listing the
 * library titles they appear in (cast) or directed (crew/Director).
 */
export function tmdbPopularPeopleHandler(role: "cast" | "crew") {
  return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const apiKey = getConfig("global_tmdb_api_key");
    if (!apiKey) throw new Error("TMDb API key is required. Configure it in Settings.");

    const { fetchPopularPeople, fetchPersonCredits } = await import("@tinkerbell/tmdb");
    const peopleLimit = Math.min(ruleConfig.limit ?? DEFAULT_PEOPLE, MAX_PEOPLE);
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

      for (const person of people) {
        ctx.signal?.throwIfAborted();
        const credits = await fetchPersonCredits({ apiKey }, person.id, {
          role,
          crewJob,
          mediaTypes: [sectionMediaType],
        });

        const matched: Array<{ ratingKey: string; title: string; year?: number }> = [];
        const seen = new Set<string>();
        for (const credit of credits) {
          const item = tmdbToItem.get(credit.id);
          if (!item || seen.has(item.ratingKey)) continue;
          seen.add(item.ratingKey);
          matched.push(item);
        }

        if (matched.length < MIN_ITEMS_PER_PERSON) {
          ctx.log(`[tmdb_popular] Skipping "${person.name}" in "${section.title}" — ${matched.length} item(s).`);
          continue;
        }

        yield { name: person.name, section, matched };
      }
    }
  };
}
