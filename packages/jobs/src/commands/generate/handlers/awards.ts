import { type Services } from "@rube/composition";

import { collectionLimit, describeLimits, filterGroups, minItemsPerGroup } from "#commands/generate/handlers/limits.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";
import { scanOmdb } from "./omdb-scan.ts";

/**
 * Award winners, read from OMDb's awards headline.
 *
 * This used to come from TMDb keywords, which are applied to so few titles
 * that a 4,241-film library produced one Academy Award winner. OMDb's
 * `Awards` line is there for nearly every film and show ("Won 7 Oscars.
 * 23 wins & 18 nominations total", "Won 16 Primetime Emmys. …").
 *
 * The line names only the award OMDb ranks highest, so a film that won both
 * an Oscar and a BAFTA lands in the Oscar group alone. Cannes and the Palme
 * d'Or are never named there, so those groups went with the keyword source.
 * Bucket keys are unchanged from the keyword version, so a rule's existing
 * collections are reconciled rather than rebuilt.
 */
export interface AwardBucket {
  key: string;
  label: string;
  pattern: RegExp;
}

const AWARD_BUCKETS: readonly AwardBucket[] = [
  { key: "awards:oscar", label: "Academy Award Winners", pattern: /\bWon \d+ Oscars?\b/i },
  { key: "awards:emmy", label: "Emmy Winners", pattern: /\bWon \d+ Primetime Emmys?\b/i },
  { key: "awards:golden_globe", label: "Golden Globe Winners", pattern: /\bWon \d+ Golden Globes?\b/i },
  { key: "awards:bafta", label: "BAFTA Winners", pattern: /\bWon \d+ BAFTA(?: Film| TV)? Awards?\b/i },
];

/** The buckets an awards headline puts a title in. Nominations are not wins. */
export function awardBucketsFor(awards: string | null): AwardBucket[] {
  if (!awards) return [];
  return AWARD_BUCKETS.filter((b) => b.pattern.test(awards));
}

export function createAwardsCommand(deps: Pick<Services, "clients" | "config">) {
  const { getOmdbClient } = deps.clients;
  const { getConfig } = deps.config;

  async function* awardsHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    if (!getConfig("global_omdb_api_key")) {
      throw new Error("OMDB API key is required for Awards rules. Configure it in Settings.");
    }

    const maxCollections = collectionLimit(ruleConfig);
    const minItems = minItemsPerGroup(ruleConfig);

    for (const section of sections) {
      ctx.signal?.throwIfAborted();
      ctx.log(`[awards] "${section.title}" — fetching all items with GUIDs...`);
      const items = await client.allItemsWithGuids(section.key);
      ctx.log(`Found ${items.length} item(s). Fetching awards via OMDB...`);

      const { answered, processed, cacheHits, apiCalls } = await scanOmdb(ctx, getOmdbClient, items);

      type Group = { bucket: AwardBucket; items: Array<{ ratingKey: string; title: string; year?: number }> };
      const groups = new Map<string, Group>();
      let winners = 0;
      for (const { item, ratings } of answered) {
        const buckets = awardBucketsFor(ratings.awards);
        if (buckets.length > 0) winners++;
        for (const bucket of buckets) {
          const entry = { ratingKey: item.ratingKey, title: item.title, year: item.year };
          const group = groups.get(bucket.key);
          if (group) group.items.push(entry);
          else groups.set(bucket.key, { bucket, items: [entry] });
        }
      }

      const ranked = filterGroups([...groups.values()], ruleConfig, (g) => g.bucket.label)
        .filter((g) => g.items.length >= minItems)
        .sort((a, b) => b.items.length - a.items.length);

      ctx.log(
        `[awards] "${section.title}" — processed ${processed} (${cacheHits} from cache, ${apiCalls} fetched from OMDB), ${winners} winner(s); ${ranked.length} group(s) to build (${describeLimits(ruleConfig)}).`,
      );

      for (const group of ranked.slice(0, maxCollections)) {
        ctx.signal?.throwIfAborted();
        yield { name: group.bucket.label, section, matched: group.items };
      }
    }
  }

  return { awardsHandler };
}
