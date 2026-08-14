/**
 * The cleanup action: what happens when a rule's ending is "remove this"
 * rather than "make a collection".
 *
 * The selection half is unchanged — the same handlers, the same smart filters.
 * All that differs is what the matched set is used for. Because the most
 * destructive ending deletes files off a disk with no undo, essentially all of
 * this file is refusals:
 *
 *   - nothing is actioned on the run that first matched it (the streak, in
 *     `domains/cleanup`)
 *   - nothing is actioned unless `cleanup_enabled` is on
 *   - nothing is actioned beyond a per-rule and a per-run global ceiling
 *   - nothing is actioned if the rule suddenly matched an implausible slice of
 *     the library
 *   - nothing is actioned if the local library index is stale
 *
 * The queue collection is built in every mode, including dry run. Being able
 * to browse "what this rule would delete" in Plex before it happens is what
 * makes the feature trustworthy, and it costs one collection.
 */
import { DAY_MS, errorMessage, getConfig, type JobContext } from "@tinkerbell/core";
import { isDestructiveMode, type CleanupActionConfig } from "@tinkerbell/contracts";
import {
  dueForAction,
  listCandidates,
  markActioned,
  recordMatches,
  type CleanupCandidate,
} from "@tinkerbell/domain.cleanup";
import { emitEvent } from "@tinkerbell/domain.events";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { commitCollection } from "./finalize.ts";
import { arrExternalId } from "./guids.ts";
import { lastSuccessfulRunAt } from "../../queries.ts";
import type { HandlerDeps } from "./types.ts";

/** Label marking the "on the chopping block" shelf, so it's findable in Plex. */
export const CLEANUP_LABEL = "Tinkerbell:Cleanup";

/** Default ceiling across every cleanup rule in one generate run. */
export const DEFAULT_MAX_DELETES_PER_RUN = 50;

/**
 * A rule matching more than this share of its sections is treated as a
 * mistake, not an instruction. The realistic way this feature hurts someone is
 * a smart filter with a typo that suddenly matches everything.
 */
export const IMPLAUSIBLE_MATCH_FRACTION = 0.25;

/** How stale the local library index may be before cleanup refuses to act. */
export const MAX_INDEX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Budget shared by every cleanup rule in a single generate run.
 *
 * Per-rule caps aren't enough on their own: five rules each staying under
 * their own limit of 30 can still empty a library overnight. Rules run
 * concurrently, so this is one mutable object threaded through them all.
 */
export interface CleanupBudget {
  remaining: number;
}

export function createCleanupBudget(): CleanupBudget {
  return { remaining: getConfig("cleanup_max_deletes_per_run") ?? DEFAULT_MAX_DELETES_PER_RUN };
}

export interface CleanupOutcome {
  matched: number;
  queued: number;
  actioned: number;
  /** Set when the rule recorded candidates but deliberately did nothing. */
  refusal?: string;
}

/**
 * Drain the handler, record what matched, and action whatever is due.
 *
 * Returns counts shaped like the collection path's so the caller's bookkeeping
 * doesn't have to branch.
 */
export async function runHandlerWithCleanup(
  deps: HandlerDeps,
  action: CleanupActionConfig,
  machineId: string,
  labels: string[],
  budget: CleanupBudget,
  handler: (
    deps: HandlerDeps,
  ) => AsyncGenerator<{ section: PlexSection; matched: Array<{ ratingKey: string; title: string }> }>,
): Promise<CleanupOutcome> {
  const { ctx, client, rule, sections } = deps;

  // 1. Selection, unchanged — accumulate across every section the rule covers.
  const matches: Array<{ ratingKey: string; sectionId: string; title: string }> = [];
  const bySection = new Map<string, { section: PlexSection; ratingKeys: string[] }>();
  for await (const pending of handler(deps)) {
    const bucket = bySection.get(pending.section.key) ?? { section: pending.section, ratingKeys: [] };
    for (const item of pending.matched) {
      matches.push({ ratingKey: item.ratingKey, sectionId: pending.section.key, title: item.title });
      bucket.ratingKeys.push(item.ratingKey);
    }
    bySection.set(pending.section.key, bucket);
  }

  ctx.log(`[cleanup] "${rule.name}" matched ${matches.length} item(s) across ${bySection.size} section(s).`);

  // 2. Record first, always. Even a run that refuses to act should advance the
  //    picture the user sees on the queue page.
  recordMatches(rule.id, matches);

  // 3. The queue collection — in every mode, dry run included.
  await commitQueueCollections(ctx, client, machineId, labels, rule.name, bySection);

  // 3b. Warn about what goes next time, while there is still time to say no.
  notifyPending(rule, action);

  const due = dueForAction(rule.id, action.consecutiveRuns, action.maxActionsPerRun);
  if (due.length === 0) {
    ctx.log(
      `[cleanup] Nothing due yet — items must match ${action.consecutiveRuns} run(s) in a row (${matches.length} tracked).`,
    );
    return { matched: matches.length, queued: matches.length, actioned: 0 };
  }

  // 4. Refusals, cheapest and most categorical first.
  const refusal = await refusalReason(ctx, client, action, sections, matches.length);
  if (refusal) {
    ctx.log(`[cleanup] REFUSING to act on ${due.length} due item(s): ${refusal}`);
    for (const c of due) ctx.log(`[cleanup]   would have ${action.mode}: "${c.title}"`);
    return { matched: matches.length, queued: matches.length, actioned: 0, refusal };
  }

  if (action.dryRun) {
    ctx.log(`[cleanup] DRY RUN — ${due.length} item(s) are due for "${action.mode}" and nothing will be touched:`);
    for (const c of due) ctx.log(`[cleanup]   would ${action.mode}: "${c.title}" (streak ${c.streak})`);
    return { matched: matches.length, queued: matches.length, actioned: 0 };
  }

  // 5. Act.
  const actioned = await applyAction(deps, action, due, budget);

  if (actioned.length > 0) {
    emitEvent("cleanup.actioned", `"${rule.name}" ${pastTense(action.mode)} ${actioned.length} item(s)`, {
      ruleId: rule.id,
      ruleName: rule.name,
      count: actioned.length,
      mode: action.mode,
      titles: actioned,
    });
  }

  return { matched: matches.length, queued: matches.length, actioned: actioned.length };
}

/**
 * Tell the user what goes on the *next* run, not what just went.
 *
 * A notification after the fact is a report; one beforehand is a chance to
 * intervene, and that is the difference between an automated deletion people
 * tolerate and one they turn off. Only fires for modes that actually remove
 * something — nobody needs a push notification about a label.
 */
function notifyPending(rule: { id: string; name: string }, action: CleanupActionConfig): void {
  if (!isDestructiveMode(action.mode) || action.dryRun) return;

  // One short of the threshold: these are actioned on the next run.
  const nextUp = listCandidates(rule.id).filter(
    (c) =>
      c.actionedAt == null &&
      c.streak === action.consecutiveRuns - 1 &&
      (c.heldUntil == null || c.heldUntil <= Date.now()),
  );
  if (nextUp.length === 0) return;

  const titles = nextUp.map((c) => c.title);
  const base = getConfig("user_app_public_url");
  const link = base ? ` Review them at ${base.replace(/\/$/, "")}/cleanup` : "";

  emitEvent(
    "cleanup.pending",
    `"${rule.name}" will ${action.mode} ${nextUp.length} item(s) on its next run unless you keep them:` +
      ` ${titles.slice(0, 10).join(", ")}${titles.length > 10 ? `, and ${titles.length - 10} more` : ""}.${link}`,
    { ruleId: rule.id, ruleName: rule.name, count: nextUp.length, mode: action.mode, titles },
  );
}

/**
 * Build the "on the chopping block" shelf, one collection per section.
 *
 * Carries the rule's own labels plus `Tinkerbell:Cleanup`, so it is both
 * swept up by the normal rule-collection lifecycle and findable on its own.
 */
async function commitQueueCollections(
  ctx: JobContext,
  client: PlexClient,
  machineId: string,
  labels: string[],
  ruleName: string,
  bySection: Map<string, { section: PlexSection; ratingKeys: string[] }>,
): Promise<void> {
  for (const { section, ratingKeys } of bySection.values()) {
    if (ratingKeys.length === 0) continue;
    try {
      await commitCollection(
        ctx,
        client,
        section,
        machineId,
        ruleName,
        ratingKeys,
        [...labels, CLEANUP_LABEL],
        // Never pinned. A homepage row of films about to be deleted is not
        // what anyone wants their family to open Plex to.
        false,
        "cleanup",
      );
    } catch (err) {
      // The shelf is a convenience; failing to build it must not stop the
      // ledger from advancing or block a legitimate action.
      ctx.log(`[cleanup] Could not build the queue collection for "${section.title}" — ${errorMessage(err)}`);
    }
  }
}

/**
 * Why this run must not act, or null if it may.
 *
 * Ordered so the cheapest and most absolute checks come first, and so the log
 * line names the single most important reason rather than a list.
 */
async function refusalReason(
  ctx: JobContext,
  client: PlexClient,
  action: CleanupActionConfig,
  sections: PlexSection[],
  matchCount: number,
): Promise<string | null> {
  if (isDestructiveMode(action.mode) && !(getConfig("cleanup_enabled") ?? false)) {
    return "cleanup is disabled globally (Settings → Cleanup). One switch stops every rule.";
  }

  const indexAge = indexAgeMs();
  if (indexAge != null && indexAge > MAX_INDEX_AGE_MS) {
    return `the local library index was last synced ${Math.floor(indexAge / DAY_MS)} day(s) ago — "nobody has watched this" is exactly the claim that goes wrong on stale data.`;
  }
  if (indexAge == null) {
    return "the library has never been synced successfully, so local watch and metadata state cannot be trusted.";
  }

  const total = await sectionItemTotal(ctx, client, sections);
  if (total > 0 && matchCount / total > IMPLAUSIBLE_MATCH_FRACTION) {
    const pct = Math.round((matchCount / total) * 100);
    return `it matched ${matchCount} of ${total} items (${pct}%), which reads as a filter mistake rather than an instruction. Candidates were recorded; nothing was touched.`;
  }

  return null;
}

/** Age of the newest successful `sync-media` run, or null if there isn't one. */
function indexAgeMs(): number | null {
  const at = lastSuccessfulRunAt("sync-media");
  return at == null ? null : Date.now() - at;
}

async function sectionItemTotal(ctx: JobContext, client: PlexClient, sections: PlexSection[]): Promise<number> {
  let total = 0;
  for (const section of sections) {
    try {
      total += await client.getSectionItemCount(section.key);
    } catch (err) {
      // Without a denominator the fraction guard can't run. Say so rather than
      // silently treating the section as empty, which would disable the guard.
      ctx.log(`[cleanup] Could not size "${section.title}" for the sanity check — ${errorMessage(err)}`);
    }
  }
  return total;
}

/** Apply the configured mode to each due candidate. Returns the titles done. */
async function applyAction(
  deps: HandlerDeps,
  action: CleanupActionConfig,
  due: CleanupCandidate[],
  budget: CleanupBudget,
): Promise<string[]> {
  const { ctx, client, rule } = deps;
  const done: string[] = [];

  for (const candidate of due) {
    ctx.signal?.throwIfAborted();

    // The global ceiling is checked per item, not per rule, because rules run
    // concurrently and each one's share is whatever is left when it gets here.
    if (isDestructiveMode(action.mode) && budget.remaining <= 0) {
      ctx.log(`[cleanup] Global per-run limit reached — stopping. The rest stay queued and go on the next run.`);
      break;
    }

    try {
      switch (action.mode) {
        case "collection_only":
          // The shelf was the whole action.
          break;
        case "label":
          await client.addItemLabel(candidate.ratingKey, CLEANUP_LABEL);
          break;
        case "unmonitor":
          await unmonitorViaArr(deps, candidate);
          break;
        case "delete":
          await deleteItem(deps, action, candidate);
          break;
      }

      markActioned(rule.id, candidate.ratingKey, action.mode);
      if (isDestructiveMode(action.mode)) budget.remaining--;
      done.push(candidate.title);
      ctx.log(`[cleanup] ${action.mode}: "${candidate.title}" (streak ${candidate.streak})`);
    } catch (err) {
      // One failure must not abandon the rest — and the row stays un-actioned,
      // so the next run retries it naturally.
      ctx.log(`[cleanup] FAILED to ${action.mode} "${candidate.title}" — ${errorMessage(err)}`);
    }
  }

  return done;
}

async function unmonitorViaArr(deps: HandlerDeps, candidate: CleanupCandidate): Promise<void> {
  const found = await findArrRecord(deps, candidate);
  if (!found) throw new Error("no matching Radarr/Sonarr record");
  const { setMonitored } = await import("@tinkerbell/arr");
  await setMonitored(found.config, found.record, false);
}

async function deleteItem(deps: HandlerDeps, action: CleanupActionConfig, candidate: CleanupCandidate): Promise<void> {
  const { ctx, client } = deps;

  if (action.viaArr) {
    const found = await findArrRecord(deps, candidate);
    if (found) {
      const { deleteRecord } = await import("@tinkerbell/arr");
      await deleteRecord(found.config, found.record, {
        deleteFiles: true,
        addImportExclusion: action.addImportExclusion,
      });
      return;
    }
    // Falling through to a Plex-only delete would leave the *Arr record
    // behind, and Radarr would re-download the same film that night. Refuse
    // instead — the item stays queued and the log says why.
    throw new Error("no matching Radarr/Sonarr record, and a Plex-only delete would just be re-downloaded");
  }

  await client.deleteItem(candidate.ratingKey);
  ctx.log(`[cleanup] Deleted "${candidate.title}" from Plex only — the *Arr record (if any) remains.`);
}

/**
 * Resolve a Plex item to its *Arr library record, via GUIDs.
 *
 * Never by title: two films share a name often enough, and the cost of being
 * wrong here is deleting the wrong file.
 */
async function findArrRecord(
  deps: HandlerDeps,
  candidate: CleanupCandidate,
): Promise<{
  config: { service: "radarr" | "sonarr"; url: string; apiKey: string };
  record: import("@tinkerbell/arr").ArrRecord;
} | null> {
  const { client, sections } = deps;
  const section = sections.find((s) => s.key === candidate.sectionId);
  const service: "radarr" | "sonarr" = section?.type === "show" ? "sonarr" : "radarr";

  const url = getConfig(service === "radarr" ? "global_radarr_url" : "global_sonarr_url");
  const apiKey = getConfig(service === "radarr" ? "global_radarr_api_key" : "global_sonarr_api_key");
  if (!url || !apiKey) return null;

  const guids = await client.getItemGuids(candidate.ratingKey);
  const externalId = arrExternalId({ guids }, service);
  if (!externalId) return null;

  const { findByExternalId } = await import("@tinkerbell/arr");
  const config = { service, url, apiKey };
  const record = await findByExternalId(config, externalId);
  return record ? { config, record } : null;
}

function pastTense(mode: string): string {
  switch (mode) {
    case "label":
      return "labelled";
    case "collection_only":
      return "queued";
    case "unmonitor":
      return "unmonitored";
    default:
      return "deleted";
  }
}
