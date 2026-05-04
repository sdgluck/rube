import type { TmdbCachedDetails } from "@tinkerbell/db";
import { getConfig } from "../../../lib/config.ts";
import { indexItemsByTmdb } from "../plex-index.ts";
import { hydrateTmdbDetails } from "../tmdb-metadata.ts";
import type { HandlerDeps, PendingCollection } from "../types.ts";

const MIN_ITEMS_PER_GROUP = 3;

/**
 * Field a TMDB-grouped rule slices the library by. Each value picks an
 * extractor that turns a single library item into 0..N (groupKey, label)
 * pairs — items with multiple genres or production companies fan out into
 * multiple groups, which matches Plex's behavior for the same fields.
 */
export type TmdbGroupedField =
  | "studios"
  | "networks"
  | "genres"
  | "countries"
  | "content_ratings"
  | "actors"
  | "directors";

interface GroupKeyLabel {
  key: string;
  label: string;
}

type Extractor = (details: TmdbCachedDetails, region: string) => GroupKeyLabel[];

const EXTRACTORS: Record<TmdbGroupedField, Extractor> = {
  studios: (d) => (d.productionCompanies ?? []).map((c) => ({ key: `c${c.id}`, label: c.name })),
  networks: (d) => (d.networks ?? []).map((n) => ({ key: `n${n.id}`, label: n.name })),
  genres: (d) => (d.genres ?? []).map((g) => ({ key: `g${g.id}`, label: g.name })),
  countries: (d) => (d.productionCountries ?? []).map((c) => ({ key: `co${c.code}`, label: c.name })),
  content_ratings: (d, region) => {
    const cert = d.contentRatings?.[region];
    return cert ? [{ key: `r${region}:${cert}`, label: cert }] : [];
  },
  // Top-billed cast only — N=10 by tmdb-cache's stored order. Avoids spamming
  // a "Generic Henchman #3" group from 200-deep cast lists.
  actors: (d) => (d.cast ?? []).slice(0, 10).map((a) => ({ key: `a${a.id}`, label: a.name })),
  directors: (d) => (d.directors ?? []).map((p) => ({ key: `d${p.id}`, label: p.name })),
};

/**
 * Generic "build one collection per X" handler driven entirely by TMDB
 * metadata. Replaces the Plex tag-based grouped handler — TMDB normalizes
 * names and IDs so groups don't fragment ("Universal" vs "Universal Pictures"
 * vs "Universal Studios International").
 */
export function tmdbGroupedHandler(field: TmdbGroupedField) {
  return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const apiKey = getConfig("global_tmdb_api_key");
    if (!apiKey) throw new Error("TMDb API key is required. Configure it in Settings.");
    const region = getConfig("global_tmdb_region") || "US";

    const maxCollections = ruleConfig.limit ?? 10;

    for (const section of sections) {
      ctx.signal?.throwIfAborted();

      // Networks rules only make sense for TV; everything else accepts both.
      if (field === "networks" && section.type !== "show") {
        ctx.log(`[${field}] Skipping "${section.title}" — networks are TV-only.`);
        continue;
      }

      ctx.log(`[${field}] "${section.title}" — indexing by TMDb ID...`);
      const { items, tmdbToItem } = await indexItemsByTmdb(client, section.key);
      ctx.log(`[${field}] ${tmdbToItem.size}/${items.length} items have TMDb IDs.`);
      if (tmdbToItem.size === 0) continue;

      const sectionMediaType: "movie" | "tv" = section.type === "show" ? "tv" : "movie";
      const pairs = Array.from(tmdbToItem.keys()).map((tmdbId) => ({ tmdbId, mediaType: sectionMediaType }));
      const cache = await hydrateTmdbDetails(ctx, { apiKey }, pairs);

      // Build groupKey -> { label, items[] }
      type Group = { label: string; items: Array<{ ratingKey: string; title: string; year?: number }> };
      const groups = new Map<string, Group>();

      for (const [tmdbId, item] of tmdbToItem) {
        const id = `${sectionMediaType}:${tmdbId}`;
        const details = cache.get(id);
        if (!details) continue;
        for (const { key, label } of EXTRACTORS[field](details, region)) {
          const bucket = groups.get(key);
          if (bucket) {
            bucket.items.push(item);
          } else {
            groups.set(key, { label, items: [item] });
          }
        }
      }

      // Filter, sort by item count desc, take top N.
      const ranked = Array.from(groups.values())
        .filter((g) => g.items.length >= MIN_ITEMS_PER_GROUP)
        .sort((a, b) => b.items.length - a.items.length);

      ctx.log(
        `[${field}] "${section.title}" — ${groups.size} group(s), ${ranked.length} pass min-items (${MIN_ITEMS_PER_GROUP}).`,
      );

      for (const group of ranked.slice(0, maxCollections)) {
        ctx.signal?.throwIfAborted();
        yield {
          name: group.label,
          section,
          matched: group.items,
        };
      }
    }
  };
}
