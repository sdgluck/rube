import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { getConfig } from "@tinkerbell/core";
import { errorMessage } from "@tinkerbell/core";
import type { JobContext } from "@tinkerbell/core";
import type { Rule } from "@tinkerbell/domain.rules";
import type { RuleConfig } from "./config.ts";
import { imdbId, tmdbId } from "./guids.ts";
import { fetchImdbChart, fetchImdbList } from "./sources/imdb.ts";
import { lookupBelongsToCollection } from "./sources/tmdb.ts";
import { chunked, mapConcurrent } from "#jobs/concurrency.ts";

/**
 * How many source lookups (a TMDb call, sometimes a Plex query first) run at
 * once. The TMDb client holds the actual rate ceiling; this is the width of
 * one rule's fan-out, sized so a chunk is worth waiting for but a chunk's
 * worth of work is all that's wasted when the collect cap lands mid-batch.
 */
const TMDB_LOOKUP_CONCURRENCY = 6;

export interface ArrResolution {
  added: number;
  skipped: number;
  failed: number;
}

/** A TMDb franchise ("belongs to collection"), as much of one as we use. */
interface Franchise {
  id: number;
  name: string;
}

/** External item not yet present in the library, queued for radarr/sonarr. */
interface Unmatched {
  externalId: string;
  mediaType: "movie" | "tv";
  displayName: string;
}

/**
 * For external-source rules with `arr.enabled`, push items that aren't
 * already in the Plex library to Radarr/Sonarr. We re-fetch the source
 * rather than thread unmatched IDs through every handler — cheaper to
 * maintain, and the source data is already cached upstream where it
 * matters.
 *
 * Skipped: rule type doesn't produce external items, arr unconfigured,
 * no unmatched items, or dryRun.
 */
export async function resolveArrAdds(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  rule: Rule,
  ruleConfig: RuleConfig,
): Promise<ArrResolution> {
  const arrCfg = ruleConfig.arr;
  if (!arrCfg || !arrCfg.enabled) return { added: 0, skipped: 0, failed: 0 };

  const unmatched = await collectUnmatched(client, sections, rule, ruleConfig, arrCfg.maxAddsPerRun);
  if (unmatched === null) return { added: 0, skipped: 0, failed: 0 };

  if (unmatched.length === 0) {
    ctx.log(`[arr] No unmatched items — nothing to add.`);
    return { added: 0, skipped: 0, failed: 0 };
  }

  const slice = unmatched.slice(0, arrCfg.maxAddsPerRun);
  ctx.log(`[arr] ${unmatched.length} unmatched item(s); will process ${slice.length} (cap=${arrCfg.maxAddsPerRun}).`);

  if (arrCfg.dryRun) {
    ctx.log(`[arr] DRY RUN — would add ${slice.length} item(s):`);
    for (const u of slice) ctx.log(`[arr]   ${u.mediaType}/${u.externalId} (${u.displayName})`);
    return { added: 0, skipped: slice.length, failed: 0 };
  }

  return pushToArr(ctx, slice, arrCfg);
}

/**
 * Walk the rule's source and collect items not present in the library.
 * Returns null when the rule type isn't arr-eligible or required config
 * is missing — distinct from "ran but found nothing" (empty array).
 */
async function collectUnmatched(
  client: PlexClient,
  sections: PlexSection[],
  rule: Rule,
  ruleConfig: RuleConfig,
  maxAddsPerRun: number,
): Promise<Unmatched[] | null> {
  // Soft cap: stop scanning sources once we have ~4× the cap so we don't
  // burn API quota on items we'll discard anyway.
  const collectCap = maxAddsPerRun * 4;

  switch (rule.type) {
    case "imdb_chart":
    case "imdb_list":
      return collectImdbUnmatched(client, sections, rule, ruleConfig);
    case "seerr_requests":
      return collectSeerrUnmatched(client, sections, ruleConfig, collectCap);
    case "tmdb_popular_actors":
    case "tmdb_popular_directors":
      return collectTmdbPeopleUnmatched(client, sections, rule, ruleConfig, collectCap);
    case "tmdb_franchises":
      return collectTmdbFranchisesUnmatched(client, sections, ruleConfig, collectCap);
    default:
      return null; // ai_prompt + Plex-only rules have nothing external to add
  }
}

async function collectImdbUnmatched(
  client: PlexClient,
  sections: PlexSection[],
  rule: Rule,
  ruleConfig: RuleConfig,
): Promise<Unmatched[] | null> {
  const contentId = rule.type === "imdb_chart" ? ruleConfig.chart : ruleConfig.listId;
  if (!contentId) return null;
  const { imdbIds } = rule.type === "imdb_chart" ? await fetchImdbChart(contentId) : await fetchImdbList(contentId);

  // Build a union of IMDb IDs already present across all selected sections.
  const present = new Set<string>();
  let mediaTypeHint: "movie" | "tv" = "movie";
  for (const section of sections) {
    if (section.type === "show") mediaTypeHint = "tv";
    const items = await client.allItemsWithGuids(section.key);
    for (const item of items) {
      const id = imdbId(item);
      if (id) present.add(id);
    }
  }

  const out: Unmatched[] = [];
  for (const id of imdbIds) {
    if (!present.has(id)) out.push({ externalId: `imdb:${id}`, mediaType: mediaTypeHint, displayName: id });
  }
  return out;
}

async function collectSeerrUnmatched(
  client: PlexClient,
  sections: PlexSection[],
  ruleConfig: RuleConfig,
  collectCap: number,
): Promise<Unmatched[] | null> {
  const seerrUrl = getConfig("global_seerr_url");
  const seerrApiKey = getConfig("global_seerr_api_key");
  if (!seerrUrl || !seerrApiKey) return null;
  const filter = ruleConfig.filter || "all";

  const presentMovie = new Set<number>();
  const presentTv = new Set<number>();
  for (const section of sections) {
    const items = await client.allItemsWithGuids(section.key);
    const target = section.type === "movie" ? presentMovie : presentTv;
    for (const item of items) {
      const id = tmdbId(item);
      if (id != null) target.add(id);
    }
  }

  const { iterSeerrRequests } = await import("@tinkerbell/seerr");
  const out: Unmatched[] = [];
  for await (const req of iterSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter })) {
    const mt = req.media.mediaType;
    const present = mt === "movie" ? presentMovie : presentTv;
    if (present.has(req.media.tmdbId)) continue;
    out.push({
      externalId: `tmdb:${req.media.tmdbId}`,
      mediaType: mt,
      displayName: `tmdb:${req.media.tmdbId}`,
    });
    if (out.length >= collectCap) break;
  }
  return out;
}

async function collectTmdbPeopleUnmatched(
  client: PlexClient,
  sections: PlexSection[],
  rule: Rule,
  ruleConfig: RuleConfig,
  collectCap: number,
): Promise<Unmatched[] | null> {
  const apiKey = getConfig("global_tmdb_api_key");
  if (!apiKey) return null;

  const { fetchPopularPeople, fetchPersonCredits } = await import("@tinkerbell/tmdb");
  const peopleLimit = Math.min(ruleConfig.limit ?? 10, 50);
  const department = rule.type === "tmdb_popular_actors" ? "Acting" : "Directing";
  const role: "cast" | "crew" = rule.type === "tmdb_popular_actors" ? "cast" : "crew";
  const crewJob = role === "crew" ? "Director" : undefined;

  const presentMovie = new Set<number>();
  const presentTv = new Set<number>();
  for (const section of sections) {
    const items = await client.allItemsWithGuids(section.key);
    const target = section.type === "movie" ? presentMovie : presentTv;
    for (const item of items) {
      const id = tmdbId(item);
      if (id != null) target.add(id);
    }
  }

  const sectionMediaTypes = new Set(sections.map((s) => (s.type === "show" ? "tv" : "movie") as "movie" | "tv"));
  const people = await fetchPopularPeople({ apiKey }, { limit: peopleLimit, department });

  // One credits request per (person, media type). Fetched a chunk at a time:
  // wide enough that fifty people aren't fifty serial round-trips, narrow
  // enough that hitting `collectCap` on the first chunk doesn't mean we've
  // already paid for the other forty.
  const lookups = people.flatMap((person) => [...sectionMediaTypes].map((mt) => ({ person, mt })));

  const out: Unmatched[] = [];
  outer: for (const batch of chunked(lookups, TMDB_LOOKUP_CONCURRENCY)) {
    const fetched = await mapConcurrent(batch, TMDB_LOOKUP_CONCURRENCY, async ({ person, mt }) => ({
      person,
      mt,
      credits: await fetchPersonCredits({ apiKey }, person.id, { role, crewJob, mediaTypes: [mt] }),
    }));

    for (const { person, mt, credits } of fetched) {
      const present = mt === "movie" ? presentMovie : presentTv;
      for (const c of credits) {
        if (present.has(c.id)) continue;
        out.push({
          externalId: `tmdb:${c.id}`,
          mediaType: mt,
          displayName: `${c.title}${c.year ? ` (${c.year})` : ""} — ${person.name}`,
        });
        if (out.length >= collectCap) break outer;
      }
    }
  }
  return out;
}

async function collectTmdbFranchisesUnmatched(
  client: PlexClient,
  sections: PlexSection[],
  ruleConfig: RuleConfig,
  collectCap: number,
): Promise<Unmatched[] | null> {
  const apiKey = getConfig("global_tmdb_api_key");
  if (!apiKey) return null;

  const { fetchCollection } = await import("@tinkerbell/tmdb");
  const groupLimit = Math.min(ruleConfig.limit ?? 25, 100);

  const out: Unmatched[] = [];
  outer: for (const section of sections) {
    if (section.type !== "movie") continue;

    const items = await client.allItemsWithGuids(section.key);
    const tmdbPresent = new Set<number>();
    const ratingKeyToTmdb = new Map<string, number>();
    for (const item of items) {
      const id = tmdbId(item);
      if (id == null) continue;
      tmdbPresent.add(id);
      ratingKeyToTmdb.set(item.ratingKey, id);
    }

    const groups = await client.fetchGroupedByField(section.key, "collection", groupLimit);
    const seenCollections = new Set<number>();

    // Each group is a Plex filter query, then two TMDb lookups. Resolving the
    // franchise first and fetching it second keeps the dedup exactly where it
    // was — two groups pointing at the same franchise still fetch it once —
    // while everything within a step overlaps.
    for (const batch of chunked(groups, TMDB_LOOKUP_CONCURRENCY)) {
      const franchises = await mapConcurrent(
        batch,
        TMDB_LOOKUP_CONCURRENCY,
        async (group): Promise<Franchise | null> => {
          const groupItems = await client.fetchItemsByFilter(group.key);
          const sampleTmdbId = groupItems
            .map((gi) => ratingKeyToTmdb.get(gi.ratingKey))
            .find((id): id is number => id !== undefined);
          if (!sampleTmdbId) return null;
          return lookupBelongsToCollection(apiKey, sampleTmdbId);
        },
      );

      // Claimed as we go, so a franchise repeated *within* a batch is still
      // only taken once.
      const fresh: Franchise[] = [];
      for (const f of franchises) {
        if (!f || seenCollections.has(f.id)) continue;
        seenCollections.add(f.id);
        fresh.push(f);
      }

      const tmdbCollections = await mapConcurrent(fresh, TMDB_LOOKUP_CONCURRENCY, (f) =>
        fetchCollection({ apiKey }, f.id),
      );

      for (const tmdbCollection of tmdbCollections) {
        for (const part of tmdbCollection.parts) {
          if (tmdbPresent.has(part.id)) continue;
          out.push({
            externalId: `tmdb:${part.id}`,
            mediaType: "movie",
            displayName: `${part.title}${part.year ? ` (${part.year})` : ""} — ${tmdbCollection.name}`,
          });
          if (out.length >= collectCap) break outer;
        }
      }
    }
  }
  return out;
}

async function pushToArr(
  ctx: JobContext,
  items: Unmatched[],
  arrCfg: NonNullable<RuleConfig["arr"]>,
): Promise<ArrResolution> {
  const { lookupByExternalId, addItem } = await import("@tinkerbell/arr");

  const byService: Record<"radarr" | "sonarr", Unmatched[]> = { radarr: [], sonarr: [] };
  for (const u of items) byService[u.mediaType === "movie" ? "radarr" : "sonarr"].push(u);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const service of ["radarr", "sonarr"] as const) {
    const queue = byService[service];
    if (queue.length === 0) continue;

    const url = getConfig(service === "radarr" ? "global_radarr_url" : "global_sonarr_url");
    const apiKey = getConfig(service === "radarr" ? "global_radarr_api_key" : "global_sonarr_api_key");
    if (!url || !apiKey) {
      ctx.log(`[arr] ${service} not configured — skipping ${queue.length} item(s).`);
      skipped += queue.length;
      continue;
    }
    const arrConfig = { service, url, apiKey };

    for (const u of queue) {
      try {
        const lookup = await lookupByExternalId(arrConfig, u.externalId);
        if (!lookup) {
          ctx.log(`[arr] ${service}: lookup miss for ${u.externalId}`);
          skipped++;
          continue;
        }
        const result = await addItem(arrConfig, lookup, {
          qualityProfileId: arrCfg.qualityProfileId,
          rootFolderPath: arrCfg.rootFolderPath,
          monitor: arrCfg.monitor,
          searchOnAdd: arrCfg.searchOnAdd,
        });
        if (result.status === "added") {
          added++;
          ctx.log(`[arr] ${service}: added "${result.title}" (id=${result.id})`);
        } else if (result.status === "exists") {
          skipped++;
          ctx.log(`[arr] ${service}: "${result.title}" already exists`);
        } else {
          failed++;
          ctx.log(`[arr] ${service}: failed — ${result.error}`);
        }
      } catch (err) {
        failed++;
        ctx.log(`[arr] ${service}: error for ${u.externalId} — ${errorMessage(err)}`);
      }
    }
  }

  ctx.log(`[arr] Summary: added=${added}, skipped=${skipped}, failed=${failed}`);
  return { added, skipped, failed };
}
