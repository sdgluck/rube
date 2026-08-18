import type { PlexSection } from "@tinkerbell/plex";
import { DEFAULT_PIN_ROTATION, producesManyCollections, ruleAction } from "@tinkerbell/contracts";
import { runHandlerWithCleanup, type CleanupBudget } from "./cleanup.ts";
import { runHandlerWithMetadata, type MetadataBudget } from "./metadata.ts";
import { appendHistory, type HistoricalCollection } from "@tinkerbell/domain.rule-history";
import { recordCollectionChanges } from "@tinkerbell/domain.rule-runs";
import { setRuleLastPinnedCollections } from "@tinkerbell/domain.rules";
import { commitCollection, COMMIT_CONCURRENCY } from "./finalize.ts";
import {
  producedKey,
  readExistingCollections,
  reconcilePins,
  removeUnproduced,
  type PinnableCollection,
} from "./reconcile.ts";
import { drainConcurrently } from "#jobs/concurrency.ts";
import { meetsPinFloor, selectRotation, rotationState, type RotationCandidate } from "./rotation.ts";
import type { Handler, HandlerDeps, PendingCollection } from "./types.ts";
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

export interface RunHandlerResult {
  lastCollectionKey: string | null;
  collectionCount: number;
  itemCount: number;
}

/**
 * Run a rule to its ending.
 *
 * A rule is (selection) → (action). Selection is the handler and is shared;
 * the action is "make a collection" — every rule that has ever existed —
 * "clean up", which queues, labels, unmonitors or deletes, or "metadata",
 * which rewrites the item's own fields.
 *
 * A rule with no `action` in its config is a collection rule, so nothing
 * predating this branch changes behaviour or needs migrating.
 *
 * The batch jobs are split by ending — `generate` owns the collection rules,
 * `cleanup` and `metadata` own theirs — so in a scheduled run this branch only ever goes
 * one way. It stays a branch because the ad-hoc path doesn't: "Run" on the
 * Rules page runs whichever single rule the user clicked.
 */
export async function runHandler(
  deps: HandlerDeps,
  machineId: string,
  labels: string[],
  budget: CleanupBudget,
  metadataBudget: MetadataBudget,
): Promise<RunHandlerResult> {
  const action = ruleAction(deps.ruleConfig);
  if (action.kind === "collection") return runHandlerWithCommits(deps, machineId, labels);

  const handler = handlerForRule(deps.rule.type);
  if (!handler) return { lastCollectionKey: null, collectionCount: 0, itemCount: 0 };

  if (action.kind === "metadata") {
    const result = await runHandlerWithMetadata(deps, action, metadataBudget, handler);
    // A metadata rule builds nothing, so there is no "last collection" to
    // point at — the Rules table shows what it wrote instead.
    return { lastCollectionKey: null, collectionCount: 0, itemCount: result.matched };
  }

  const outcome = await runHandlerWithCleanup(deps, action, budget, handler);
  // A cleanup rule builds no collections at all — the queue lives in
  // Tinkerbell, and the Rules table shows queued/actioned counts instead.
  return { lastCollectionKey: null, collectionCount: 0, itemCount: outcome.matched };
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
  //
  // Grouped rules build one collection per director/studio/decade, which in a
  // large library is hundreds. Pinning all of them buries every other homepage
  // row, so they always rotate — the wizard makes the count mandatory, and
  // rules saved before it did fall back to the same default.
  let rotationCount = pinToHomepage ? (ruleConfig.pinRotationCount ?? 0) : 0;
  if (pinToHomepage && rotationCount === 0 && producesManyCollections(rule.type)) {
    rotationCount = DEFAULT_PIN_ROTATION;
    ctx.log(
      `[pin] No rotation count set for a "${rule.type}" rule — pinning ${rotationCount} per library instead of every collection.`,
    );
  }
  const rotating = rotationCount > 0;
  // Optional floor on what's worth a homepage row. Independent of `minItems`,
  // which decides whether the collection is built at all — a rule can keep its
  // long tail in the library and still only promote the substantial ones.
  const pinMinItems = pinToHomepage ? (ruleConfig.pinMinItems ?? 0) : 0;
  const rotationCandidates: RotationCandidate[] = [];
  let lastCollectionKey: string | null = null;
  let collectionCount = 0;
  let itemCount = 0;
  let belowPinFloor = 0;

  // ai_prompt history is collected per section and flushed in a `finally`
  // so partial-success runs still persist the collections that DID make
  // it into Plex — original behavior. If we accumulate and only flush on
  // clean completion, a mid-run throw silently loses every committed
  // section's history and the next run retreads the same themes.
  const aiHistoryBySection = new Map<string, { section: PlexSection; entries: HistoricalCollection[] }>();

  // What this rule already owns, read once before anything is written. The run
  // used to open by deleting all of it; now each pending collection is matched
  // against it by name and reconciled, and whatever is never matched is removed
  // at the end. Read up front rather than per collection so a grouped rule
  // producing hundreds still costs one listing per section.
  const existing = await readExistingCollections(client, deps.sections, rule.id);
  const produced = new Set<string>();
  // Every collection this run committed, so the homepage can be reconciled once
  // at the end against the full set rather than guessed at per collection.
  const committed: PinnableCollection[] = [];
  // Those substantial enough to earn a row, when the rule pins at all. For a
  // rotating rule this is the candidate pool rather than the answer.
  const wantsPin = new Set<string>();

  // A grouped rule yields hundreds of collections and each commit is several
  // Plex round-trips, so the handler's output is drained by a pool rather than
  // one collection at a time. The real ceiling on Plex writes is the shared
  // queue inside `commitCollection` — this pool only has to be wide enough to
  // keep it fed, and the handler body still runs serially either way.
  try {
    await drainConcurrently(
      handler(deps),
      COMMIT_CONCURRENCY,
      async (pending) => {
        const ratingKeys = pending.matched.map((m) => m.ratingKey);
        const pinnable = meetsPinFloor(ratingKeys.length, pinMinItems);
        if (!pinnable) belowPinFloor++;
        // Claimed before the commit, not after: the leftover sweep runs on this
        // set, and a collection whose commit failed still exists in Plex and
        // must not be swept away as though the rule had stopped producing it.
        produced.add(producedKey(pending.section.key, pending.name));
        const collectionKey = await commitCollection(ctx, client, {
          section: pending.section,
          machineId,
          name: pending.name,
          ratingKeys,
          labels,
          ruleType: rule.type,
          ruleId: rule.id,
          ruleConfig,
          sourceSummary: pending.sourceSummary,
          existing: existing.get(pending.section.key)?.get(pending.name.toLowerCase()),
        });
        if (!collectionKey) return;

        recordChanges(deps, pending, collectionKey);

        // Only ever mutated between awaits, so there's no interleaving to
        // guard against — but nothing here may assume commit order either.
        lastCollectionKey = collectionKey;
        collectionCount++;
        itemCount += ratingKeys.length;
        committed.push({ sectionKey: pending.section.key, ratingKey: collectionKey, name: pending.name });
        if (pinToHomepage && pinnable) wantsPin.add(collectionKey);

        if (rotating && pinnable) {
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
      },
      ctx.signal,
    );
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

  if (belowPinFloor > 0) {
    ctx.log(
      `[pin] ${belowPinFloor} collection(s) have fewer than ${pinMinItems} items — created, but left off the homepage.`,
    );
  }

  // Only after a clean handler run. A rule that threw halfway has an incomplete
  // `produced` set, and sweeping against it would delete collections the rule
  // still makes — the run simply never got as far as saying so.
  if (!ctx.signal?.aborted) {
    await removeUnproduced(ctx, client, existing, produced);
  }

  // What *should* be on the homepage when this run is done. A rotating rule
  // promotes a subset of its candidates; everything else promotes whatever
  // cleared the floor. Either way the answer is only knowable now, with the
  // whole set in hand — which is why pinning is no longer done per commit.
  const desired = rotating ? await selectPinRotation(deps, rotationCandidates, rotationCount) : wantsPin;
  await reconcilePins(ctx, client, committed, desired);

  return { lastCollectionKey, collectionCount, itemCount };
}

/**
 * Diff this commit against the membership remembered from the rule's previous
 * run, and file the result under the run that made it.
 *
 * Best-effort by construction: the collection is already in Plex by the time
 * this is reached, and failing to write its changeset is not a reason to fail
 * the run that succeeded. A missed changeset costs one run's worth of history
 * and self-corrects on the next one, because the snapshot is only replaced
 * when the write lands.
 */
function recordChanges(deps: HandlerDeps, pending: PendingCollection, collectionKey: string): void {
  if (!deps.ruleRunId) return;
  try {
    const diff = recordCollectionChanges({
      runId: deps.ruleRunId,
      ruleId: deps.rule.id,
      sectionKey: pending.section.key,
      sectionTitle: pending.section.title,
      collectionName: pending.name,
      collectionRatingKey: collectionKey,
      members: pending.matched.map((m) => ({ ratingKey: m.ratingKey, title: m.title })),
    });
    if (diff.added.length > 0 || diff.removed.length > 0) {
      deps.ctx.log(`"${pending.name}": +${diff.added.length} / -${diff.removed.length} since the last run.`);
    }
  } catch (err) {
    deps.ctx.log(`Failed to record changes for "${pending.name}":`, err);
  }
}

/**
 * Choose the rotating subset of this run's collections to promote.
 *
 * Only reached on a clean handler run — a rule that threw halfway has an
 * incomplete candidate set, and rotating over it would both under-pin the home
 * and burn a rotation slot on collections the next run will pick from again
 * anyway.
 *
 * Chooses but does not pin: `reconcilePins` applies the answer, because it also
 * has to *unpin* last rotation's picks. Under delete-and-recreate that came
 * free — the old collections were gone — and it is the one thing reconciling
 * them instead would otherwise get quietly wrong, a few stale rows at a time.
 */
async function selectPinRotation(
  deps: HandlerDeps,
  candidates: RotationCandidate[],
  count: number,
): Promise<Set<string>> {
  const { ctx, rule } = deps;
  if (candidates.length === 0) return new Set();

  const previous = rule.lastPinnedCollections ?? {};
  const selected = selectRotation(candidates, count, previous);

  // Persisted from the selection rather than from what landed. The two used to
  // differ because pinning happened here and could fail per collection; now a
  // failure is reported by `reconcilePins` and the homepage is re-diffed from
  // scratch next run, so recording the intent is both simpler and self-healing.
  setRuleLastPinnedCollections(rule.id, rotationState(selected));
  ctx.log(`Rotating ${selected.length} of ${candidates.length} collection(s) onto the homepage (${count}/library).`);
  return new Set(selected.map((candidate) => candidate.ratingKey));
}
