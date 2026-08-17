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
 *   - nothing destructive is actioned unless `cleanup_enabled` is on. The switch
 *     lives in `standingRefusal` in `domains/cleanup`, because everything that
 *     *warns* about a removal has to ask the same question the engine does —
 *     and `label`/`collection_only` are exempt, since they take nothing away
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
import { arrInstances, errorMessage, getConfig, type JobContext } from "@tinkerbell/core";
import { isDestructiveMode, type CleanupActionConfig } from "@tinkerbell/contracts";
import {
  actionedSince,
  dueForAction,
  KILL_SWITCH_REFUSAL,
  listCandidates,
  markActioned,
  protectedRatingKeys,
  recordMatches,
  standingRefusal,
  type CleanupCandidate,
} from "@tinkerbell/domain.cleanup";
import { emitEvent } from "@tinkerbell/domain.events";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { arrExternalId } from "./guids.ts";
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

  const allDue = dueForAction(rule.id, action.consecutiveRuns, action.maxActionsPerRun);

  // 3b. The approval gate, for a rule that has one.
  //
  // `consecutiveRuns` protects against a metadata blip. It does not protect
  // against a filter that is *consistently* wrong — one that matches the same
  // 400 films every night is exactly as confident on run three as on run one.
  // Applied after `dueForAction` rather than inside it so the log can say what
  // is waiting on a human, which is the only reason anyone would ever go and
  // look.
  let due = allDue;
  if (action.requireApproval && isDestructiveMode(action.mode)) {
    due = allDue.filter((c) => c.approvedAt != null);
    const waiting = allDue.length - due.length;
    if (waiting > 0) {
      ctx.log(`[cleanup] ${waiting} due item(s) are waiting for approval and will not be ${action.mode}d:`);
      for (const c of allDue.filter((x) => x.approvedAt == null))
        ctx.log(`[cleanup]   awaiting approval: "${c.title}"`);
    }
  }

  if (due.length === 0) {
    ctx.log(
      allDue.length > 0
        ? `[cleanup] Nothing approved — ${allDue.length} item(s) are due but this rule holds destructive actions until a human says yes.`
        : `[cleanup] Nothing due yet — items must match ${action.consecutiveRuns} run(s) in a row (${matches.length} tracked).`,
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

  // Protection and the approval gate are checked here as well as at action
  // time, because this message names titles and says they go on the next run.
  // A protected item is never going anywhere, and an item on an approval-gated
  // rule goes when somebody says so, not on a schedule — naming either is the
  // kind of false alarm that gets a notification channel muted.
  const protectedKeys = protectedRatingKeys();
  const needsApproval = action.requireApproval === true;

  // One short of the threshold: these are actioned on the next run.
  const nextUp = listCandidates(rule.id).filter(
    (c) =>
      c.actionedAt == null &&
      c.streak === action.consecutiveRuns - 1 &&
      (c.heldUntil == null || c.heldUntil <= Date.now()) &&
      !protectedKeys.has(c.ratingKey) &&
      (!needsApproval || c.approvedAt != null),
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
  const found = await findArrRecords(deps, candidate);
  if (found.length === 0) throw new Error("no matching Radarr/Sonarr record");
  const { setMonitored } = await import("@tinkerbell/arr");
  // Every instance holding it. Leaving one still monitoring is the same defect
  // as leaving the record behind — see `findArrRecords`.
  for (const { config, record } of found) await setMonitored(config, record, false);
}

async function deleteItem(deps: HandlerDeps, action: CleanupActionConfig, candidate: CleanupCandidate): Promise<void> {
  const { ctx, client } = deps;

  if (action.viaArr) {
    const found = await findArrRecords(deps, candidate);
    if (found.length > 0) {
      const { deleteRecord } = await import("@tinkerbell/arr");
      for (const { config, record } of found) {
        await deleteRecord(config, record, {
          deleteFiles: true,
          addImportExclusion: action.addImportExclusion,
        });
      }
      if (found.length > 1) {
        ctx.log(
          `[cleanup] "${candidate.title}" was in ${found.length} ${found[0].config.service} instances — removed from each.`,
        );
      }
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

interface ArrMatch {
  config: { service: "radarr" | "sonarr"; url: string; apiKey: string };
  record: import("@tinkerbell/arr").ArrRecord;
}

/**
 * Resolve a Plex item to its *Arr library record(s), via GUIDs.
 *
 * Never by title: two films share a name often enough, and the cost of being
 * wrong here is deleting the wrong file.
 *
 * Returns every instance that holds it, because more than one can — see the
 * note inside.
 */
async function findArrRecords(deps: HandlerDeps, candidate: CleanupCandidate): Promise<ArrMatch[]> {
  const { client, sections } = deps;
  const section = sections.find((s) => s.key === candidate.sectionId);
  // Never guess. Defaulting an unresolvable section to Radarr would look up a
  // TV series' TMDb id against the movie library, where it can collide with an
  // unrelated film — which the caller then deletes with `deleteFiles: true`.
  if (!section) return [];
  const service: "radarr" | "sonarr" = section.type === "show" ? "sonarr" : "radarr";

  const instances = arrInstances(service);
  if (instances.length === 0) return [];

  const guids = await client.getItemGuids(candidate.ratingKey);
  const externalId = arrExternalId({ guids }, service);
  if (!externalId) return [];

  const { findByExternalId } = await import("@tinkerbell/arr");

  // Every instance of the service, and every one that *holds* the record — not
  // the first. With a split HD/4K setup the same film is frequently in both, and
  // there is no way to tell from the Plex side. Stopping at the first holder
  // deleted from Radarr-HD while Radarr-4K carried on monitoring it, so the film
  // came back that night: exactly the outcome the "refuse rather than delete
  // from Plex only" branch above exists to prevent.
  const found: ArrMatch[] = [];
  for (const instance of instances) {
    const config = { service, url: instance.url, apiKey: instance.apiKey };
    const record = await findByExternalId(config, externalId);
    if (record) found.push({ config, record });
  }
  return found;
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
