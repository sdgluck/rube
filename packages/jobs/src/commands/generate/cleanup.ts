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
 * Nothing here writes a collection to Plex. Cleanup rules used to build an "on
 * the chopping block" shelf per section so you could browse what a rule would
 * remove from the sofa, but a rule that matches badly — and matching badly is
 * exactly what the refusals above exist to catch — puts a collection of most
 * of the library in front of the whole household before anyone has agreed to
 * anything. The review surface is Tinkerbell's own Cleanup queue, which costs
 * the server nothing and can say "streak 1/3" and "held until Friday" in a way
 * a Plex collection never could.
 *
 * The one thing cleanup still writes to Plex is an item label, in `label` mode,
 * on the items themselves — see `applyAction`.
 */
import { arrInstances, DAY_MS, errorMessage, getConfig, type JobContext } from "@tinkerbell/core";
import { isDestructiveMode, type CleanupActionConfig } from "@tinkerbell/contracts";
import {
  actionedSince,
  dueForAction,
  listCandidates,
  markActioned,
  recordMatches,
  type CleanupCandidate,
} from "@tinkerbell/domain.cleanup";
import { emitEvent } from "@tinkerbell/domain.events";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { arrExternalId } from "./guids.ts";
import { lastSuccessfulRunAt } from "../../queries.ts";
import type { HandlerDeps } from "./types.ts";

/** Applied to the items themselves in `label` mode, so they're findable in Plex. */
export const CLEANUP_LABEL = "Tinkerbell:Cleanup";

/** Default ceiling on destructive actions across every rule, per rolling day. */
export const DEFAULT_MAX_DELETES_PER_DAY = 50;

/** The window the ceiling applies over. */
export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A rule matching more than this share of its sections is treated as a
 * mistake, not an instruction. The realistic way this feature hurts someone is
 * a smart filter with a typo that suddenly matches everything.
 */
export const IMPLAUSIBLE_MATCH_FRACTION = 0.25;

/** How stale the local library index may be before cleanup refuses to act. */
export const MAX_INDEX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * The ceiling on destructive actions, across every rule and every run.
 *
 * Per-rule caps don't compose — five rules each staying under their own limit
 * of 30 can still empty a library — so the ceiling has to be global. It used
 * to be a counter created per job run and threaded through the concurrent rule
 * loop, which bounded exactly one batch: `runSingleRule` created a fresh full
 * budget for every ad-hoc run, so running five rules by hand granted five
 * budgets, and a second cleanup job would have granted another.
 *
 * So the ceiling is now a rolling window read from the candidate ledger, which
 * already timestamps every action. Spend is what *happened*, not what this
 * process remembers doing, which means it holds across concurrent rules,
 * ad-hoc runs, a restart mid-run, and any number of jobs.
 *
 * `reserve()` still exists, and still reserves before the await rather than
 * after success: up to eight rules run concurrently, and counting only on
 * completion lets all eight pass the same check.
 */
export interface CleanupBudget {
  /** False when the ceiling is reached. Reserves a slot when true. */
  reserve: () => boolean;
  /** Hand a reserved slot back — the action failed, so nothing was spent. */
  release: () => void;
  remaining: () => number;
}

export function createCleanupBudget(now: number = Date.now()): CleanupBudget {
  const ceiling = getConfig("cleanup_max_deletes_per_day") ?? DEFAULT_MAX_DELETES_PER_DAY;
  // Read once at the start of the run, then tracked in memory. Re-querying per
  // item would be correct too, but this way a long run can't be widened by its
  // own oldest actions ageing out of the window while it is still going.
  const alreadySpent = actionedSince(now - BUDGET_WINDOW_MS);
  let reserved = 0;
  return {
    reserve: () => {
      if (alreadySpent + reserved >= ceiling) return false;
      reserved++;
      return true;
    },
    release: () => {
      reserved--;
    },
    remaining: () => Math.max(0, ceiling - alreadySpent - reserved),
  };
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
  budget: CleanupBudget,
  handler: (
    deps: HandlerDeps,
  ) => AsyncGenerator<{ section: PlexSection; matched: Array<{ ratingKey: string; title: string }> }>,
): Promise<CleanupOutcome> {
  const { ctx, client, rule, sections } = deps;

  // 1. Selection, unchanged — accumulate across every section the rule covers.
  const matches: Array<{ ratingKey: string; sectionId: string; title: string }> = [];
  const sectionsMatched = new Set<string>();
  for await (const pending of handler(deps)) {
    for (const item of pending.matched) {
      matches.push({ ratingKey: item.ratingKey, sectionId: pending.section.key, title: item.title });
      sectionsMatched.add(pending.section.key);
    }
  }

  ctx.log(`[cleanup] "${rule.name}" matched ${matches.length} item(s) across ${sectionsMatched.size} section(s).`);

  // 2. Record first, always. Even a run that refuses to act should advance the
  //    picture the user sees on the queue page.
  recordMatches(rule.id, matches);

  // 3. Warn about what goes next time. Deliberately before the due check —
  //    the run where items reach the final streak is usually a run where
  //    nothing is due yet, and that is precisely when the warning is useful.
  //    Suppressed when a standing refusal means the deletion will never come.
  if (!standingRefusal()) notifyPending(rule, action);

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
  const standing = standingRefusal();
  if (standing && (standing !== KILL_SWITCH_REFUSAL || isDestructiveMode(action.mode))) return standing;

  const total = await sectionItemTotal(ctx, client, sections);
  if (total == null) {
    return "Plex could not be asked how large the library is, so the sanity check on how much this rule matched cannot run.";
  }
  if (total > 0 && matchCount / total > IMPLAUSIBLE_MATCH_FRACTION) {
    const pct = Math.round((matchCount / total) * 100);
    return `it matched ${matchCount} of ${total} items (${pct}%), which reads as a filter mistake rather than an instruction. Candidates were recorded; nothing was touched.`;
  }

  return null;
}

const KILL_SWITCH_REFUSAL = "cleanup is disabled globally (Settings → Cleanup). One switch stops every rule.";

/**
 * Refusals that hold for the whole run regardless of what matched — the global
 * switch and a stale library index.
 *
 * Split out from the full check because they are cheap (no Plex round trip)
 * and because they are the ones that persist: a rule blocked by either of
 * these is blocked every single run, so the pending warning must stay quiet
 * rather than promising a deletion that never arrives. A channel that cries
 * wolf nightly is one people mute.
 */
function standingRefusal(): string | null {
  if (!(getConfig("cleanup_enabled") ?? false)) return KILL_SWITCH_REFUSAL;

  const indexAge = indexAgeMs();
  if (indexAge == null) {
    return "the library has never been synced successfully, so local watch and metadata state cannot be trusted.";
  }
  if (indexAge > MAX_INDEX_AGE_MS) {
    return `the local library index was last synced ${Math.floor(indexAge / DAY_MS)} day(s) ago — "nobody has watched this" is exactly the claim that goes wrong on stale data.`;
  }
  return null;
}

/** Age of the newest successful `sync-media` run, or null if there isn't one. */
function indexAgeMs(): number | null {
  const at = lastSuccessfulRunAt("sync-media");
  return at == null ? null : Date.now() - at;
}

/**
 * Total items across the rule's sections, or null if we couldn't size any.
 *
 * Null rather than zero matters: without a denominator the fraction guard has
 * nothing to compare against, and treating that as "0 items, so 0% matched"
 * would silently switch the guard off at exactly the wrong moment — Plex being
 * unresponsive is when a filter is most likely to be returning nonsense.
 *
 * A partial sum is still usable. It under-counts the library, which makes the
 * guard stricter, and erring strict is the right direction here.
 */
async function sectionItemTotal(ctx: JobContext, client: PlexClient, sections: PlexSection[]): Promise<number | null> {
  let total = 0;
  let sized = 0;
  for (const section of sections) {
    try {
      total += await client.getSectionItemCount(section.key);
      sized++;
    } catch (err) {
      ctx.log(`[cleanup] Could not size "${section.title}" for the sanity check — ${errorMessage(err)}`);
    }
  }
  return sized === 0 ? null : total;
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
    // Checking and reserving are one step for the same reason.
    const spendsBudget = isDestructiveMode(action.mode);
    if (spendsBudget && !budget.reserve()) {
      ctx.log(`[cleanup] Daily limit reached — stopping. The rest stay queued and go on the next run.`);
      break;
    }

    try {
      switch (action.mode) {
        case "collection_only":
          // The shelf was the whole action.
          break;
        case "label": {
          const section = deps.sections.find((sec) => sec.key === candidate.sectionId);
          if (!section) throw new Error(`section ${candidate.sectionId} is not in this rule's scope`);
          await client.addItemLabel(candidate.ratingKey, section.key, section.type, CLEANUP_LABEL);
          break;
        }
        case "unmonitor":
          await unmonitorViaArr(deps, candidate);
          break;
        case "delete":
          await deleteItem(deps, action, candidate);
          break;
      }

      markActioned(rule.id, candidate.ratingKey, action.mode);
      done.push(candidate.title);
      ctx.log(`[cleanup] ${action.mode}: "${candidate.title}" (streak ${candidate.streak})`);
    } catch (err) {
      // Nothing was removed, so hand the reserved slot back rather than
      // letting a run of failures eat the whole budget.
      if (spendsBudget) budget.release();
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
  // Never guess. Defaulting an unresolvable section to Radarr would look up a
  // TV series' TMDb id against the movie library, where it can collide with an
  // unrelated film — which the caller then deletes with `deleteFiles: true`.
  if (!section) return null;
  const service: "radarr" | "sonarr" = section.type === "show" ? "sonarr" : "radarr";

  const instances = arrInstances(service);
  if (instances.length === 0) return null;

  const guids = await client.getItemGuids(candidate.ratingKey);
  const externalId = arrExternalId({ guids }, service);
  if (!externalId) return null;

  const { findByExternalId } = await import("@tinkerbell/arr");

  // Every instance of the service, not one of them. With a split 4K setup the
  // film is in whichever instance downloaded it, and there is no way to know
  // which from the Plex side — so the record is looked up in each until one
  // has it. Deleting through the wrong instance is not a possible outcome:
  // an instance that does not hold the record returns nothing to delete.
  for (const instance of instances) {
    const config = { service, url: instance.url, apiKey: instance.apiKey };
    const record = await findByExternalId(config, externalId);
    if (record) return { config, record };
  }
  return null;
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
