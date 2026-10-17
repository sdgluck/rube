import { type Services } from "@tinkerbell/composition";
/**
 * Bringing a rule's collections into line with what it selected, instead of
 * deleting them and building them again.
 *
 * Every rule run used to open by deleting every collection carrying its
 * `Rule:<id>` label and then recreating the lot. That is the simplest thing
 * that can possibly work, and it is why so much of the rest of the system is
 * careful: a run was destructive, non-idempotent and expensive, so running a
 * rule more often cost real Plex writes and opened a window where the shelf did
 * not exist. The lock, the commit queue and most of the scheduling caution are
 * all downstream of that one property.
 *
 * A run is now a diff. The common case — a nightly rebuild of a collection
 * whose membership did not change — costs a read and nothing else. What that
 * buys, beyond the writes:
 *
 * - **No gap.** The collection is never absent, so nobody browsing at 01:00
 *   sees a half-built home screen.
 * - **Identity survives.** A collection keeps its rating key from run to run,
 *   so hand-set artwork and anything else Plex hangs off that key stops being
 *   reset every night.
 * - **Over-running is cheap.** A rule asked for twice does its work once and
 *   then almost nothing, which is what makes the queue's coalescing a nicety
 *   rather than a necessity.
 *
 * Two things it must not get wrong, both of which recreation handled by
 * accident and this has to handle on purpose: pins, because a surviving
 * collection keeps one that rotation may no longer want (see
 * `applyPinRotation`), and item order (see `RECREATE_CHURN_RATIO`).
 */

import PQueue from "p-queue";
import { PlexApiError, type PlexClient, type PlexSection } from "@tinkerbell/plex";

import type { JobContext } from "@tinkerbell/core";

/** How many Plex calls this module may have in flight. Mirrors `COMMIT_CONCURRENCY`. */
const RECONCILE_CONCURRENCY = 6;

/**
 * Past this share of the existing membership being wrong, rebuild instead.
 *
 * Plex has no bulk remove: `removeCollectionItem` is one DELETE per item, while
 * a rebuild is one POST carrying every rating key. So a collection that has
 * turned over almost entirely — a shuffle rule, a "recently added" shelf — is
 * genuinely cheaper to recreate, and past roughly half it is not close.
 *
 * It also quietly settles ordering. Plex appends what you add and this codebase
 * has no move endpoint, so a reconciled collection drifts from the order the
 * handler yielded. For a heavily churned collection that drift would be most of
 * the collection; a rebuild restores the intended order exactly.
 */
const RECREATE_CHURN_RATIO = 0.5;

export interface ExistingCollection {
  ratingKey: string;
  title: string;
}

/** A rule's current collections in one section, keyed by lowercased title. */
export type ExistingBySection = Map<string, Map<string, ExistingCollection>>;

/** One person's copy of a rule's row, as Plex has it. */
export interface PersonalCopy extends ExistingCollection {
  sectionKey: string;
  /** Lowercased, from the copy's `User:` label. */
  username: string;
}

/**
 * Everything a rule owns, split by whose it is.
 *
 * A rule's shared collections and each opted-in person's copy of them carry the
 * same `Rule:<id>` label and read the same, and this listing used to make no
 * distinction. When personal copies were built by a separate job that cost two
 * things: the rule's run claimed a person's copy as its own collection (the
 * run's link then died when that job replaced the copy), and once copies got
 * per-person titles the sweep below deleted every one of them on every run,
 * because none matched a name the rule produced. The `User:` label is the line.
 */
export interface RuleCollections {
  shared: ExistingBySection;
  /** Matched by exact title — see `personal.ts` — so not keyed by name. */
  personal: PersonalCopy[];
}

/**
 * What this rule currently owns, per section.
 *
 * Matched on title because that is the only stable handle a rule has had on its
 * own output: rating keys changed every night under delete-and-recreate, and
 * the rule's own membership snapshot (`rule_collection_members`) is keyed the
 * same way for the same reason. Reconcile is what makes those keys stable
 * again, but the snapshot's shape is not this change's to rewrite.
 */
export async function readExistingCollections(
  client: PlexClient,
  sections: PlexSection[],
  ruleId: string,
): Promise<RuleCollections> {
  const label = `Rule:${ruleId}`;
  const wanted = label.toLowerCase();
  const shared: ExistingBySection = new Map();
  const personal: PersonalCopy[] = [];

  for (const section of sections) {
    const collections = await client.getCollectionsWithLabels(section.key, { label });
    const owned = new Map<string, ExistingCollection>();
    for (const col of collections) {
      // Filtered server-side, then checked again here — the filter is what
      // makes this cheap, the check is what makes it safe to write against.
      if (!col.labels.some((tag) => tag.toLowerCase() === wanted)) continue;
      const owner = col.labels.find((tag) => tag.toLowerCase().startsWith("user:"));
      if (owner) {
        personal.push({
          ratingKey: col.ratingKey,
          title: col.title,
          sectionKey: section.key,
          username: owner.slice("user:".length).toLowerCase(),
        });
        continue;
      }
      owned.set(col.title.toLowerCase(), { ratingKey: col.ratingKey, title: col.title });
    }
    shared.set(section.key, owned);
  }

  return { shared, personal };
}

export interface ReconcileResult {
  ratingKey: string;
  added: number;
  removed: number;
}

/**
 * Bring one existing collection's membership in line with `ratingKeys`.
 *
 * Returns null when the caller should rebuild instead — the collection is
 * smart, or has churned past the point where diffing is the cheaper answer.
 */
export async function reconcileMembership(
  ctx: JobContext,
  client: PlexClient,
  existing: ExistingCollection,
  machineId: string,
  ratingKeys: string[],
): Promise<ReconcileResult | null> {
  let detail;
  try {
    detail = await client.getCollectionDetail(existing.ratingKey);
  } catch (err) {
    // Listed at the start of the run, gone by the time this rule reached it.
    // One missing collection used to fail the whole run — 526 studios built
    // and none of them committed — when the answer is just to build it again.
    if (err instanceof PlexApiError && err.status === 404) {
      ctx.log(`"${existing.title}" is no longer in Plex - building it again.`);
      return null;
    }
    throw err;
  }

  // A smart collection's membership *is* its filter, and the add endpoint would
  // replace that filter with a fixed list. Rules build static collections, so
  // this is one somebody converted by hand — leave the diff alone and let the
  // caller rebuild it as the static collection the rule asked for.
  if (detail.smart) {
    ctx.log(`"${existing.title}" is a smart collection - rebuilding it as a static one.`);
    return null;
  }

  const current = await client.getCollectionChildren(existing.ratingKey, { smart: false });
  const currentKeys = new Set(current.map((item) => item.ratingKey));
  const wantedKeys = new Set(ratingKeys);

  const toAdd = ratingKeys.filter((key) => !currentKeys.has(key));
  const toRemove = [...currentKeys].filter((key) => !wantedKeys.has(key));

  if (currentKeys.size > 0 && toRemove.length / currentKeys.size > RECREATE_CHURN_RATIO) {
    ctx.log(
      `"${existing.title}": ${toRemove.length} of ${currentKeys.size} items no longer match - rebuilding rather than removing them one at a time.`,
    );
    return null;
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ratingKey: existing.ratingKey, added: 0, removed: 0 };
  }

  // Additions first, as one call. Doing them before the removals means the
  // collection is never briefly emptier than either state - it only ever holds
  // the union, which is the better thing for somebody to catch mid-run.
  if (toAdd.length > 0) {
    try {
      await client.addCollectionItems(existing.ratingKey, machineId, toAdd);
    } catch (err) {
      // Plex keeps collection membership as a tag named by the title, so a
      // second collection created under a title already in use is a shell:
      // it holds nothing, and once its twin is gone Plex answers every add to
      // it with a 400, every night, for good. Seen on a real server after a
      // run created rules' collections a second time. Rebuilding is the only
      // way out, and the caller deletes the shell before it creates.
      if (err instanceof PlexApiError && err.status === 400) {
        ctx.log(`Plex won't add items to "${existing.title}" - rebuilding it.`);
        return null;
      }
      throw err;
    }
  }

  let removed = 0;
  const removals = new PQueue({ concurrency: RECONCILE_CONCURRENCY });
  await Promise.all(
    toRemove.map((key) =>
      removals.add(async () => {
        // Already gone is the state we asked for, but it isn't ours to claim.
        if (await client.removeCollectionItem(existing.ratingKey, key)) removed++;
      }),
    ),
  );

  ctx.log(`"${existing.title}": +${toAdd.length} / -${removed}.`);
  return { ratingKey: existing.ratingKey, added: toAdd.length, removed };
}

/** The key `produced` is tracked under - section plus lowercased title. */
export function producedKey(sectionKey: string, name: string): string {
  return `${sectionKey} ${name.toLowerCase()}`;
}

/** One of this rule's collections, and whether it should be on the homepage. */
export interface PinnableCollection {
  sectionKey: string;
  ratingKey: string;
  name: string;
}

/**
 * Make the homepage match what the rule actually wants pinned.
 *
 * Under delete-and-recreate this needed no thought: every collection was new
 * every night, so it arrived unpinned and `commitCollection` pinned the ones it
 * wanted. Reconciled collections survive, and they keep their pins - so a rule
 * whose rotation moved on, or whose "pin to homepage" was switched off, would
 * leave rows on the home screen that nothing intends to be there, accumulating
 * a little more every night.
 *
 * One `getManagedHubs` read per section answers exactly which of this rule's
 * collections are pinned right now, so the writes are only the differences.
 * That is strictly less work than the old path, which re-pinned every
 * collection on every run because it had just built them all from nothing.
 */
export async function reconcilePins(
  ctx: JobContext,
  client: PlexClient,
  committed: PinnableCollection[],
  desired: Set<string>,
): Promise<{ pinned: number; unpinned: number }> {
  const bySection = new Map<string, PinnableCollection[]>();
  for (const entry of committed) {
    bySection.set(entry.sectionKey, [...(bySection.get(entry.sectionKey) ?? []), entry]);
  }

  let pinned = 0;
  let unpinned = 0;

  for (const [sectionKey, entries] of bySection) {
    let currentlyPinned: Set<string>;
    try {
      const hubs = await client.getManagedHubs(sectionKey);
      currentlyPinned = new Set(hubs.map((hub) => hub.identifier.split(".").pop() ?? "").filter(Boolean));
    } catch (err) {
      // Without the read there is no safe diff: pinning everything wanted would
      // be right but re-pin the already-pinned, and unpinning would be a guess.
      // Leave the section's pins alone and say so.
      ctx.log(`[pin] Could not read the homepage for section ${sectionKey}, leaving its pins alone:`, err);
      continue;
    }

    for (const entry of entries) {
      const wanted = desired.has(entry.ratingKey);
      const isPinned = currentlyPinned.has(entry.ratingKey);
      if (wanted === isPinned) continue;
      try {
        if (wanted) {
          await client.pinToHomepage(sectionKey, entry.ratingKey, {
            promotedToOwnHome: 1,
            promotedToRecommended: 1,
            promotedToSharedHome: 1,
          });
          pinned++;
        } else {
          await client.unpinFromHomepage(sectionKey, `custom.collection.${sectionKey}.${entry.ratingKey}`);
          unpinned++;
        }
      } catch (err) {
        // One bad pin shouldn't cost the rest of the set its homepage row.
        ctx.log(`[pin] Failed to ${wanted ? "pin" : "unpin"} "${entry.name}":`, err);
      }
    }
  }

  if (pinned > 0 || unpinned > 0) {
    ctx.log(`[pin] Pinned ${pinned} and unpinned ${unpinned} collection(s).`);
  }
  return { pinned, unpinned };
}

export function createReconcileCommand(deps: Pick<Services, "collections">) {
  const { collections } = deps;
  const { forgetCollections } = collections;

  /**
   * Delete the collections this rule owned but no longer produces.
   *
   * The counterpart to not deleting everything up front: a rule that stops
   * selecting a director must still take that director's shelf down. Runs once at
   * the end, when the produced set is finally known.
   */
  async function removeUnproduced(
    ctx: JobContext,
    client: PlexClient,
    existing: ExistingBySection,
    produced: Set<string>,
  ): Promise<number> {
    const stale: string[] = [];
    for (const [sectionKey, owned] of existing) {
      for (const [name, collection] of owned) {
        if (!produced.has(producedKey(sectionKey, name))) stale.push(collection.ratingKey);
      }
    }
    const deleted = await removeCollections(ctx, client, stale);
    if (deleted > 0) ctx.log(`Removed ${deleted} collection(s) this rule no longer produces.`);
    return deleted;
  }

  /** Delete these collections, a few at a time, and drop them from the local index. */
  async function removeCollections(ctx: JobContext, client: PlexClient, ratingKeys: string[]): Promise<number> {
    if (ratingKeys.length === 0) return 0;
    const deletes = new PQueue({ concurrency: RECONCILE_CONCURRENCY });
    const deleted: string[] = [];
    await Promise.all(
      ratingKeys.map((ratingKey) =>
        deletes.add(async () => {
          try {
            await client.deleteItem(ratingKey);
            deleted.push(ratingKey);
          } catch (err) {
            ctx.log(`Failed to remove a collection this rule no longer produces:`, err);
          }
        }),
      ),
    );

    // Evict the local rows in the same breath, or the Collections page shows them
    // alongside the ones that survived until the next sync notices they're gone.
    forgetCollections(deleted);
    return deleted.length;
  }

  return { removeUnproduced, removeCollections };
}
