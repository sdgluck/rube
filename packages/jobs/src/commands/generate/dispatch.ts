import type { PlexSection } from "@tinkerbell/plex";
import { appendHistory, type HistoricalCollection } from "@tinkerbell/domain.rule-history";
import { setRuleLastPinnedCollections } from "@tinkerbell/domain.rules";
import { commitCollection } from "./finalize.ts";
import { selectRotation, rotationState, type RotationCandidate } from "./rotation.ts";
import type { Handler, HandlerDeps } from "./types.ts";
import { aiPromptHandler } from "./handlers/ai-prompt.ts";
import { ratedHandler } from "./handlers/rated.ts";
import { tmdbGroupedHandler } from "./handlers/tmdb-grouped.ts";
import { imdbContentHandler } from "./handlers/imdb-content.ts";
import { rtTopRatedHandler } from "./handlers/rt-top-rated.ts";
import { seerrRequestsHandler } from "./handlers/seerr-requests.ts";
import { tmdbPopularPeopleHandler } from "./handlers/tmdb-popular-people.ts";
import { tmdbFranchisesHandler } from "./handlers/tmdb-franchises.ts";
import { yearGroupedHandler } from "./handlers/year-grouped.ts";
import { mediaGroupedHandler } from "./handlers/media-grouped.ts";
import { keywordGroupedHandler } from "./handlers/keyword-grouped.ts";
import { listSourceHandler } from "./handlers/list-source.ts";
import { smartFilterHandler } from "./handlers/smart-filter.ts";

/**
 * Pick the handler for a given rule type. Returning null is a real case —
 * unknown rule types are surfaced as a no-op rather than an error so a
 * misconfigured rule doesn't break a whole batch run.
 */
export function handlerForRule(ruleType: string): Handler | null {
  switch (ruleType) {
    case "ai_prompt":
      return aiPromptHandler;
    case "top_rated":
      return ratedHandler("top");
    case "lowest_rated":
      return ratedHandler("lowest");
    case "actors":
    case "directors":
    case "studios":
    case "networks":
    case "genres":
    case "countries":
    case "content_ratings":
    case "streaming":
      return tmdbGroupedHandler(ruleType);
    case "decades":
    case "years":
      return yearGroupedHandler(ruleType);
    case "resolutions":
    case "audio_languages":
    case "subtitle_languages":
    case "video_formats":
      return mediaGroupedHandler(ruleType);
    case "based_on":
    case "seasonal":
    case "awards":
      return keywordGroupedHandler(ruleType);
    case "tmdb_popular_actors":
      return tmdbPopularPeopleHandler("cast");
    case "tmdb_popular_directors":
      return tmdbPopularPeopleHandler("crew");
    case "tmdb_franchises":
      return tmdbFranchisesHandler;
    case "imdb_chart":
      return imdbContentHandler("chart");
    case "imdb_list":
      return imdbContentHandler("list");
    case "rt_top_rated":
      return rtTopRatedHandler;
    case "seerr_requests":
      return seerrRequestsHandler;
    case "list_source":
      return listSourceHandler;
    case "smart_filter":
      return smartFilterHandler;
    default:
      return null;
  }
}

/**
 * Run a handler to completion, committing each yielded collection to Plex.
 * For ai_prompt rules, also append per-section history so the next run
 * sees what's already been generated.
 */
export async function runHandlerWithCommits(
  deps: HandlerDeps,
  machineId: string,
  labels: string[],
): Promise<{ lastCollectionKey: string | null; collectionCount: number; itemCount: number }> {
  const handler = handlerForRule(deps.rule.type);
  if (!handler) return { lastCollectionKey: null, collectionCount: 0, itemCount: 0 };

  const { ctx, client, rule, ruleConfig } = deps;
  const pinToHomepage = ruleConfig.pinToHomepage ?? true;
  // With a rotation count set we can't decide what to pin as collections
  // stream past — the choice is "N of all of them", and we only know the
  // full set once the handler is done. So commit unpinned and pin at the end.
  const rotationCount = pinToHomepage ? (ruleConfig.pinRotationCount ?? 0) : 0;
  const rotating = rotationCount > 0;
  const rotationCandidates: RotationCandidate[] = [];
  let lastCollectionKey: string | null = null;
  let collectionCount = 0;
  let itemCount = 0;

  // ai_prompt history is collected per section and flushed in a `finally`
  // so partial-success runs still persist the collections that DID make
  // it into Plex — original behavior. If we accumulate and only flush on
  // clean completion, a mid-run throw silently loses every committed
  // section's history and the next run retreads the same themes.
  const aiHistoryBySection = new Map<string, { section: PlexSection; entries: HistoricalCollection[] }>();

  try {
    for await (const pending of handler(deps)) {
      const ratingKeys = pending.matched.map((m) => m.ratingKey);
      const collectionKey = await commitCollection(
        ctx,
        client,
        pending.section,
        machineId,
        pending.name,
        ratingKeys,
        labels,
        rotating ? false : pinToHomepage,
        rule.type,
      );
      if (!collectionKey) continue;

      lastCollectionKey = collectionKey;
      collectionCount++;
      itemCount += ratingKeys.length;

      if (rotating) {
        rotationCandidates.push({
          sectionKey: pending.section.key,
          name: pending.name,
          ratingKey: collectionKey,
        });
      }

      if (rule.type === "ai_prompt" && pending.matchedTitles) {
        const bucket = aiHistoryBySection.get(pending.section.key) ?? {
          section: pending.section,
          entries: [],
        };
        bucket.entries.push({ name: pending.name, sampleItems: pending.matchedTitles });
        aiHistoryBySection.set(pending.section.key, bucket);
      }
    }
  } finally {
    for (const { section, entries } of aiHistoryBySection.values()) {
      if (entries.length === 0) continue;
      try {
        appendHistory(rule.id, section.key, section.title, entries);
        ctx.log(`Recorded ${entries.length} collection(s) in rule history.`);
      } catch (err) {
        ctx.log(`Failed to record rule history for "${section.title}":`, err);
      }
    }
  }

  if (rotating) {
    await applyPinRotation(deps, rotationCandidates, rotationCount);
  }

  return { lastCollectionKey, collectionCount, itemCount };
}

/**
 * Pin a rotating subset of this run's collections. Only reached on a clean
 * handler run — a rule that threw halfway has an incomplete candidate set,
 * and rotating over it would both under-pin the home and burn a rotation
 * slot on collections the next run will pick from again anyway.
 */
async function applyPinRotation(deps: HandlerDeps, candidates: RotationCandidate[], count: number): Promise<void> {
  const { ctx, client, rule } = deps;
  if (candidates.length === 0) return;

  const previous = rule.lastPinnedCollections ?? {};
  const selected = selectRotation(candidates, count, previous);

  const pinned: RotationCandidate[] = [];
  for (const candidate of selected) {
    try {
      await client.pinToHomepage(candidate.sectionKey, candidate.ratingKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      pinned.push(candidate);
    } catch (err) {
      // One bad pin shouldn't cost the whole rotation — the rest of the set
      // is still worth putting on the home.
      ctx.log(`Failed to pin "${candidate.name}":`, err);
    }
  }

  // Persist what actually landed, so a collection that failed to pin isn't
  // treated as "shown recently" and skipped by the next rotation.
  setRuleLastPinnedCollections(rule.id, rotationState(pinned));
  ctx.log(`Pinned ${pinned.length} of ${candidates.length} collection(s) to the homepage (rotating ${count}/library).`);
}
