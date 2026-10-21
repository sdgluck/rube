import { SEASON_PRESETS } from "@rube/contracts";
import { type Services } from "@rube/composition";
import { createTmdbMetadataCommand } from "../tmdb-metadata.ts";
import type { TmdbCachedDetails } from "@rube/db";

import { indexItemsByTmdb } from "#commands/generate/plex-index.ts";

import { collectionLimit, describeLimits, filterGroups, minItemsPerGroup } from "#commands/generate/handlers/limits.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

export type KeywordGroupedField = "based_on" | "seasonal" | "awards";

export interface KeywordBucket {
  /** Stable key — used to dedup groupings within a single rule run. */
  key: string;
  label: string;
  /** TMDb keyword IDs that put an item in this bucket. */
  keywordIds: number[];
}

/**
 * "Based on X" buckets driven by TMDb keyword IDs. The keyword set is small
 * and stable upstream — IDs verified against
 * https://www.themoviedb.org/talk/56063e8419c2952d2c00be01 and the public
 * /keyword endpoint at the time of writing.
 */
const BASED_ON: KeywordBucket[] = [
  { key: "based_on:novel", label: "Based on a Novel", keywordIds: [9714, 818, 9707] },
  { key: "based_on:true_story", label: "Based on a True Story", keywordIds: [9672, 5565] },
  { key: "based_on:comic", label: "Based on a Comic Book", keywordIds: [9717, 9715, 849] },
  { key: "based_on:video_game", label: "Based on a Video Game", keywordIds: [282, 9358] },
  { key: "based_on:play", label: "Based on a Play", keywordIds: [4565, 5616] },
  { key: "based_on:short_story", label: "Based on a Short Story", keywordIds: [156087, 167248] },
];

/**
 * Seasonal buckets — the same holidays Season Collections builds, from the
 * one table in contracts. Every preset, whether or not that feature has it
 * switched on: a rule picks its buckets with `includeValues`.
 *
 * Keyword only. These used to also take any film released in the holiday's
 * month, which made every December release "Christmas" — and since most of
 * the old ids pointed at unrelated keywords, the month was doing nearly all
 * the matching.
 */
const SEASONAL: KeywordBucket[] = SEASON_PRESETS.map((season) => ({
  key: `seasonal:${season.key}`,
  label: season.name,
  keywordIds: season.keywords.map((k) => k.id),
}));

/**
 * Awards. TMDb's keyword coverage for awards is sparse — there are
 * "academy award" / "bafta" / "palme d'or" style keywords but they're
 * applied inconsistently. This is a starter set; users with a larger
 * award library can extend via custom rule config in a future release.
 */
const AWARDS: KeywordBucket[] = [
  { key: "awards:oscar", label: "Academy Award Winners", keywordIds: [220391, 209714] },
  { key: "awards:bafta", label: "BAFTA Winners", keywordIds: [221111] },
  { key: "awards:palme_dor", label: "Palme d'Or", keywordIds: [233316] },
  { key: "awards:golden_globe", label: "Golden Globe Winners", keywordIds: [220957] },
  { key: "awards:cannes", label: "Cannes Selections", keywordIds: [192917] },
];

const BUCKETS: Record<KeywordGroupedField, KeywordBucket[]> = {
  based_on: BASED_ON,
  seasonal: SEASONAL,
  awards: AWARDS,
};

export function matchesBucket(bucket: KeywordBucket, details: TmdbCachedDetails): boolean {
  return (details.keywords ?? []).some((id) => bucket.keywordIds.includes(id));
}

/** For tests: the buckets a field builds. */
export function bucketsFor(field: KeywordGroupedField): readonly KeywordBucket[] {
  return BUCKETS[field];
}

export function createKeywordGroupedCommand(deps: Services) {
  const { config } = deps;
  const { getConfig } = config;
  const { hydrateTmdbDetails } = createTmdbMetadataCommand(deps);

  /**
   * Generic "build one collection per keyword bucket" handler. Bucket
   * definitions are static so the same TMDb cache row drives all three
   * rule types — no extra round-trips beyond what the existing grouped
   * rules already pay.
   */
  function keywordGroupedHandler(field: KeywordGroupedField) {
    return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
      const { ctx, client, sections, ruleConfig } = deps;
      const apiKey = getConfig("global_tmdb_api_key");
      if (!apiKey) throw new Error("TMDb API key is required. Configure it in Settings.");

      const buckets = BUCKETS[field];
      const maxCollections = collectionLimit(ruleConfig);
      const minItems = minItemsPerGroup(ruleConfig);

      for (const section of sections) {
        ctx.signal?.throwIfAborted();

        ctx.log(`[${field}] "${section.title}" — indexing by TMDb ID...`);
        const { items, tmdbToItem } = await indexItemsByTmdb(client, section.key);
        ctx.log(`[${field}] ${tmdbToItem.size}/${items.length} items have TMDb IDs.`);
        if (tmdbToItem.size === 0) continue;

        const sectionMediaType: "movie" | "tv" = section.type === "show" ? "tv" : "movie";
        const pairs = [...tmdbToItem.keys()].map((tmdbId) => ({ tmdbId, mediaType: sectionMediaType }));
        const cache = await hydrateTmdbDetails(ctx, { apiKey }, pairs);

        type Group = { bucket: KeywordBucket; items: Array<{ ratingKey: string; title: string; year?: number }> };
        const groups = new Map<string, Group>();
        let withSignal = 0;

        for (const [tmdbId, item] of tmdbToItem) {
          const id = `${sectionMediaType}:${tmdbId}`;
          const details = cache.get(id);
          if (!details) continue;

          let matched = false;
          for (const bucket of buckets) {
            if (matchesBucket(bucket, details)) {
              matched = true;
              const group = groups.get(bucket.key);
              if (group) group.items.push(item);
              else groups.set(bucket.key, { bucket, items: [item] });
            }
          }
          if (matched) withSignal++;
        }

        const ranked = filterGroups([...groups.values()], ruleConfig, (g) => g.bucket.label)
          .filter((g) => g.items.length >= minItems)
          .sort((a, b) => b.items.length - a.items.length);

        ctx.log(
          `[${field}] "${section.title}" — ${withSignal}/${tmdbToItem.size} items matched a bucket; ${ranked.length} bucket(s) to build (${describeLimits(ruleConfig)}).`,
        );

        for (const group of ranked.slice(0, maxCollections)) {
          ctx.signal?.throwIfAborted();
          yield {
            name: group.bucket.label,
            section,
            matched: group.items,
          };
        }
      }
    };
  }

  return { keywordGroupedHandler };
}
