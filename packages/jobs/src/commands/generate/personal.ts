/**
 * Each opted-in person's copy of a personalisable rule's rows, built in the
 * same run as the rule's own collections.
 *
 * This used to be a separate `personalize` job that re-ran every
 * personalisable rule per person a few hours after `generate`. The two jobs
 * wrote collections with the same label and, before per-person titles, the
 * same title, and neither could tell its own from the other's: the rule's run
 * claimed a person's copy as its collection (whose link then died when the
 * other job replaced it), and once copies had their own titles the rule's
 * sweep deleted every copy on every run. One run that builds both, and an
 * ownership split on the `User:` label (`reconcile.ts`), is what makes the
 * line between them real.
 *
 * Per person, in order:
 *  - rows they declined in the portal ("Not for me") are skipped;
 *  - titles they never want are dropped from each row;
 *  - a row under the rule's pin floor is not built at all — a copy exists to
 *    be a row on their home screen, unlike the shared collection, which is
 *    still worth having in the library;
 *  - their row cap counts copies across rules in list order;
 *  - the copy is committed like any rule collection, so it is reconciled in
 *    place run after run rather than deleted and recreated.
 *
 * Rows come from the shared run's own output — no rule type but `ai_prompt`
 * reads a person's preferences, so re-querying Plex once per person (as the
 * old job did) bought nothing. `ai_prompt` rules are asked again per person.
 */
import { like } from "drizzle-orm";
import { displayTitle, personalRowTitle, type JobContext, type UserPreferences } from "@rube/core";
import { collections as collectionsTable, plexUsers } from "@rube/db";
import type { Services } from "@rube/composition";
import { keepOffRecommended, personalRowLabels, personalRowPin } from "../../personalize/personal-row.ts";
import { createFinalizeCommand } from "./finalize.ts";
import { createReconcileCommand, type PersonalCopy } from "./reconcile.ts";
import { meetsPinFloor } from "./rotation.ts";
import type { HandlerDeps, PendingCollection } from "./types.ts";

export interface PersonalPassInput {
  deps: HandlerDeps;
  machineId: string;
  /** What the rule's own run yielded — the rows each person gets a copy of. */
  shared: PendingCollection[];
  /** Every copy of this rule's rows that exists now, whoever's. */
  existing: PersonalCopy[];
  /** The rule's handler again, for the one rule type whose output depends on who it's for. */
  rerun: (prefs: UserPreferences) => AsyncIterable<PendingCollection>;
}

/** The snapshot key for a person's copy: distinct per person, and readable in the run's change list. */
export function personalChangeName(rowName: string, username: string): string {
  return `${rowName} — for ${username}`;
}

export function createPersonalPass(deps: Services) {
  const { config, db, preferences, ruleRuns, rules } = deps;
  const { getPersonalizedSharingStatus } = config;
  const { listOptedInUserPreferences } = preferences;
  const { recordCollectionChanges } = ruleRuns;
  const { getEnabledRules } = rules;
  const { commitCollection } = createFinalizeCommand(deps);
  const { removeCollections } = createReconcileCommand(deps);

  /**
   * How many copies each person already has from personalisable rules that
   * come before this one — what their row cap has left for it.
   *
   * Read from the local collections index rather than Plex: one query instead
   * of a listing per section per rule. In a batch, rules run concurrently, so an
   * earlier rule's count can be one run stale; a person may get a row more or
   * less for a night, never a row that outlives the next run's count.
   */
  function copiesFromEarlierRules(ruleId: string): Map<string, number> {
    const order = getEnabledRules();
    const earlier = new Set<string>();
    for (const r of order) {
      if (r.id === ruleId) break;
      earlier.add(`Rule:${r.id}`);
    }
    const counts = new Map<string, number>();
    if (earlier.size === 0) return counts;
    const rows = db
      .select({ labels: collectionsTable.labels })
      .from(collectionsTable)
      .where(like(collectionsTable.labels, '%"User:%'))
      .all();
    for (const { labels } of rows) {
      if (!labels.some((l) => earlier.has(l))) continue;
      const owner = labels.find((l) => l.startsWith("User:"));
      if (!owner) continue;
      const key = owner.slice("User:".length).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  function ownerUsernames(): Set<string> {
    return new Set(
      db
        .select({ username: plexUsers.username, isOwner: plexUsers.isOwner })
        .from(plexUsers)
        .all()
        .filter((u) => u.isOwner === 1)
        .map((u) => u.username.toLowerCase()),
    );
  }

  async function runPersonalPass(input: PersonalPassInput): Promise<void> {
    const { deps: handlerDeps, existing } = input;
    const { ctx, client, rule, ruleConfig } = handlerDeps;

    // Off, or being switched on or off: the enable/disable jobs own every
    // `User:` row while they work, and with it off nobody could see a copy.
    if (getPersonalizedSharingStatus() !== "enabled") {
      if (existing.length > 0 && ruleConfig.personalizable) {
        ctx.log(`[personal] Personalized home screens aren't on — leaving ${existing.length} personal row(s) alone.`);
      }
      return;
    }

    const keep = new Set<string>();
    const sharedUsersCopies = new Map<string, Set<string>>();
    if (ruleConfig.personalizable) {
      const people = listOptedInUserPreferences();
      if (people.length === 0) ctx.log("[personal] Nobody has opted in through the portal yet.");
      const elsewhere = copiesFromEarlierRules(rule.id);
      const owners = ownerUsernames();
      for (const person of people) {
        if (ctx.signal?.aborted) return;
        await buildFor(ctx, input, person.username, person.preferences, elsewhere, owners, keep, sharedUsersCopies);
      }
    }
    for (const [sectionId, keys] of sharedUsersCopies) {
      const moved = await keepOffRecommended(client, sectionId, keys).catch((err) => {
        ctx.log(`[personal] Couldn't take shared users' rows off Recommended:`, err);
        return 0;
      });
      if (moved > 0) ctx.log(`[personal] Took ${moved} shared user row(s) off the library's Recommended tab.`);
    }

    // Only after every person was built: a pass cut short has an incomplete
    // `keep`, and sweeping against it would delete copies the rule still makes.
    // Covers someone who opted out, declined the row, ran out of cap or fell
    // under the floor — and every copy, when the rule stops being personalisable.
    if (ctx.signal?.aborted) return;
    const stale = existing.filter((copy) => !keep.has(copy.ratingKey)).map((copy) => copy.ratingKey);
    const removed = await removeCollections(ctx, client, stale);
    if (removed > 0) ctx.log(`[personal] Removed ${removed} personal row(s) nobody gets any more.`);
  }

  async function buildFor(
    ctx: JobContext,
    input: PersonalPassInput,
    username: string,
    prefs: UserPreferences,
    elsewhere: Map<string, number>,
    owners: Set<string>,
    keep: Set<string>,
    /** Copies kept as they were, for shared users, by section — see `keepOffRecommended`. */
    sharedUsersCopies: Map<string, Set<string>>,
  ): Promise<void> {
    const { deps: handlerDeps, machineId, existing } = input;
    const { client, rule, ruleConfig } = handlerDeps;
    const lower = username.toLowerCase();
    let allowance = (prefs.rowCount ?? Infinity) - (elsewhere.get(lower) ?? 0);
    if (allowance <= 0) {
      ctx.log(`[personal] ${username}: row cap reached by earlier rules.`);
      return;
    }

    const excludedTitles = new Set(prefs.excludedTitles.map((t) => t.toLowerCase()));
    const declined = new Set(prefs.excludedCollections.map((t) => displayTitle(t).toLowerCase()));
    const pinMinItems = ruleConfig.pinMinItems ?? 0;
    const source = rule.type === "ai_prompt" ? input.rerun(prefs) : input.shared;

    // Chosen in order first, so the cap takes the rule's first rows; then
    // committed together, throttled by the shared queue inside `commitCollection`.
    const chosen: Array<{ pending: PendingCollection; ratingKeys: string[] }> = [];
    for await (const pending of source) {
      if (allowance <= 0) break;
      if (declined.has(pending.name.toLowerCase())) continue;
      const matched = pending.matched.filter((m) => !excludedTitles.has(m.title.toLowerCase()));
      if (!meetsPinFloor(matched.length, pinMinItems) || matched.length === 0) continue;
      chosen.push({ pending, ratingKeys: matched.map((m) => m.ratingKey) });
      allowance--;
    }

    let made = 0;
    await Promise.all(
      chosen.map(async ({ pending, ratingKeys }) => {
        const title = personalRowTitle(pending.name, username);
        // Exact title, which carries this person's marks: a copy from before
        // per-person titles doesn't match, is left out of `keep`, and goes in
        // the sweep — replaced once by one under their own title.
        const current = existing.find(
          (c) => c.username === lower && c.sectionKey === pending.section.key && c.title === title,
        );
        // Claimed before the commit, as the shared sweep does: a copy whose
        // commit failed still exists and must not be swept as unwanted.
        if (current) keep.add(current.ratingKey);
        const key = await commitCollection(ctx, client, {
          section: pending.section,
          machineId,
          name: title,
          displayName: pending.name,
          groupLabel: pending.groupLabel,
          ratingKeys,
          labels: personalRowLabels(username, `Rule:${rule.id}`),
          ruleType: rule.type,
          ruleId: rule.id,
          ruleConfig,
          sourceSummary: pending.sourceSummary,
          existing: current,
          personalCopy: true,
        });
        if (!key) return;
        keep.add(key);
        made++;
        // A copy exists to be a row on their home screen, so it is pinned when
        // it is made. A reconciled copy keeps whatever pin it has — moved or
        // hidden by its person is theirs to keep.
        if (key !== current?.ratingKey) {
          await client.pinToHomepage(pending.section.key, key, personalRowPin(owners.has(lower))).catch((err) => {
            ctx.log(`[personal] Couldn't pin "${pending.name}" for ${username}:`, err);
          });
        } else if (!owners.has(lower)) {
          const keys = sharedUsersCopies.get(pending.section.key) ?? new Set<string>();
          sharedUsersCopies.set(pending.section.key, keys.add(key));
        }
        recordPersonalChanges(input, pending, username, key, ratingKeys);
      }),
    );
    if (chosen.length > 0) ctx.log(`[personal] ${username}: ${made} of ${chosen.length} row(s) built.`);
  }

  function recordPersonalChanges(
    input: PersonalPassInput,
    pending: PendingCollection,
    username: string,
    collectionKey: string,
    ratingKeys: string[],
  ): void {
    const { ctx, rule, ruleRunId } = input.deps;
    if (!ruleRunId) return;
    const wanted = new Set(ratingKeys);
    try {
      const name = personalChangeName(pending.name, username);
      const diff = recordCollectionChanges({
        runId: ruleRunId,
        ruleId: rule.id,
        sectionKey: pending.section.key,
        sectionTitle: pending.section.title,
        collectionName: name,
        collectionRatingKey: collectionKey,
        members: pending.matched
          .filter((m) => wanted.has(m.ratingKey))
          .map((m) => ({ ratingKey: m.ratingKey, title: m.title })),
      });
      if (diff.added.length > 0 || diff.removed.length > 0) {
        ctx.log(`"${name}": +${diff.added.length} / -${diff.removed.length} since the last run.`);
      }
    } catch (err) {
      ctx.log(`Failed to record changes for "${pending.name}" (${username}):`, err);
    }
  }

  return { runPersonalPass };
}
