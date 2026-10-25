/**
 * "Keep at the top": rows a rule or feature has asked to stay first among the
 * collection rows on Home.
 *
 * Two things bury them otherwise. `pinToHomepage` appends, so any job that
 * pins a new row — a new person's We Think You'd Like, a rule's rebuilt
 * collection — lands it below everything; and the `shuffle` job reorders
 * every collection hub at random every half hour. So the set is resolved here,
 * the shuffle leaves it alone, and `applyTopPins` puts it back in front after
 * every job that pins (`sidequest/job.ts`, and `runSingleRule` for the runs
 * that don't go through a worker).
 *
 * A collection doesn't record who made it, only its labels: `Rule:<id>` for a
 * rule's rows (personal copies included), the feature's own label for a
 * feature's. So "which hubs" is answered from the local `collections` mirror,
 * which every pinning path keeps current — one query, no Plex call.
 */
import { createPlexClient, type PlexClient, type PlexSection } from "@rube/plex";
import { pinFirstInSection } from "@rube/domain.shuffle-hubs";
import { collections, jobs } from "@rube/db";
import type { Services } from "@rube/composition";
import { errorMessage } from "@rube/core";
import type { CommandName } from "./commands/catalog.ts";
import { plexConnection, resolveTargetSections } from "./commands/ai-collection-shared.ts";

/**
 * Each feature that pins rows, by command, and the label its rows carry.
 *
 * Literals rather than imports of each command's constant, because importing
 * them would load every command's module graph into whatever reads this —
 * the catalog lazy-loads them for exactly that reason. `hub-order.test.ts`
 * holds the two equal.
 */
export const PIN_TO_TOP_LABELS = {
  "because-you-watched": "BecauseYouWatched",
  "we-think-youd-like": "WeThinkYoudLike",
  "pick-it-back-up": "PickItBackUp",
  "season-collections": "SeasonCollections",
  "finish-the-franchise": "FinishTheFranchise",
  "watch-it-again": "WatchItAgain",
  "new-for-you": "NewForYou",
  "more-from": "MoreFrom",
  "requests-arrived": "RequestsArrived",
  "leaving-soon": "LeavingSoon",
} as const satisfies Partial<Record<CommandName, string>>;

/** The commands after which the top rows are put back in front. */
export function pinsHubs(command: string): boolean {
  return command === "generate" || command in PIN_TO_TOP_LABELS;
}

type HubOrderDeps = Pick<Services, "db" | "rules" | "config" | "clients">;

export function createHubOrder(deps: HubOrderDeps) {
  const { db } = deps;
  const { getRules } = deps.rules;
  const { getConfig } = deps.config;

  /** The labels whose rows are kept at the top, from rule and feature settings. */
  function topLabels(): Set<string> {
    const labels = new Set<string>();
    for (const rule of getRules()) {
      const config = rule.config as { pinToTop?: boolean; pinToHomepage?: boolean };
      // `pinToHomepage` defaults on, so only an explicit `false` rules it out.
      if (config.pinToTop && config.pinToHomepage !== false) labels.add(`Rule:${rule.id}`);
    }
    for (const job of db.select({ command: jobs.command, config: jobs.config }).from(jobs).all()) {
      const label = PIN_TO_TOP_LABELS[job.command as keyof typeof PIN_TO_TOP_LABELS];
      if (!label) continue;
      const config = job.config as { pinToTop?: boolean; pinToHomepage?: boolean };
      if (config.pinToTop && config.pinToHomepage !== false) labels.add(label);
    }
    return labels;
  }

  /** Rating keys of every collection kept at the top. */
  function topPinnedRatingKeys(): Set<string> {
    const labels = topLabels();
    const keys = new Set<string>();
    if (labels.size === 0) return keys;
    const rows = db.select({ key: collections.plexRatingKey, labels: collections.labels }).from(collections).all();
    for (const row of rows) {
      if (row.labels.some((l) => labels.has(l))) keys.add(row.key);
    }
    return keys;
  }

  /**
   * Put the top rows back in front in each of `sections`.
   *
   * Never throws: the job that called it has already done its work, and a
   * wrong order is not worth failing it over. Each library is tried even if
   * one before it failed.
   */
  async function applyTopPins(client: PlexClient, sections: PlexSection[], log: (msg: string) => void): Promise<void> {
    let keep: Set<string>;
    try {
      keep = topPinnedRatingKeys();
    } catch (err) {
      log(`Couldn't work out which rows stay at the top: ${errorMessage(err)}`);
      return;
    }
    if (keep.size === 0) return;
    for (const section of sections) {
      try {
        await pinFirstInSection(client, section, keep, log);
      } catch (err) {
        log(`"${section.title}" — couldn't keep the top rows first: ${errorMessage(err)}`);
      }
    }
  }

  /** `applyTopPins` across every managed library, for callers without a client of their own. */
  async function applyTopPinsEverywhere(opts: { signal?: AbortSignal; log?: (msg: string) => void } = {}) {
    const log = opts.log ?? (() => {});
    const { url, token } = plexConnection(getConfig);
    if (!token) return;
    try {
      const client = createPlexClient({
        url,
        token,
        signal: opts.signal,
        onHealth: deps.clients.plexHealthCallback,
      });
      const sections = await resolveTargetSections(client, getConfig, undefined);
      await applyTopPins(client, sections, log);
    } catch (err) {
      log(`Couldn't keep the top rows first: ${errorMessage(err)}`);
    }
  }

  return { topPinnedRatingKeys, applyTopPins, applyTopPinsEverywhere };
}
