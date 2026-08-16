/**
 * Per-item changesets: what a run actually did to each collection it owns.
 *
 * A run's counts say "40 collections, 900 items". They cannot say that
 * "Sci-Fi Gems" lost fourteen titles overnight because an OMDb rating moved,
 * and since every run deletes and recreates its collections, Plex can't say it
 * either — the collection that knew is gone. So the membership is snapshotted
 * at the end of each commit and diffed against at the start of the next one.
 *
 * The snapshot is keyed by collection NAME, not rating key, for the same
 * reason the pin-rotation state is: rating keys don't survive a
 * delete-and-recreate cycle and names do.
 */

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, ruleCollectionMembers, ruleRunChanges } from "@tinkerbell/db";

export interface ChangesetMember {
  ratingKey: string;
  title: string;
}

export type ChangeKind = "added" | "removed";

export interface CollectionDiff {
  added: ChangesetMember[];
  removed: ChangesetMember[];
}

/**
 * Diff two membership lists.
 *
 * Compared by rating key alone — a title that Plex re-matched keeps its key,
 * and reporting a rename as "one added, one removed" would be noise dressed up
 * as a change. The *title* carried into the changeset is the newer one for
 * additions and the remembered one for removals, so each row reads the way the
 * item looked at the moment it moved.
 *
 * Exported and pure so the interesting half is testable without a database.
 */
export function diffMembers(before: readonly ChangesetMember[], after: readonly ChangesetMember[]): CollectionDiff {
  const beforeKeys = new Set(before.map((m) => m.ratingKey));
  const afterKeys = new Set(after.map((m) => m.ratingKey));
  return {
    added: after.filter((m) => !beforeKeys.has(m.ratingKey)),
    removed: before.filter((m) => !afterKeys.has(m.ratingKey)),
  };
}

/** The membership remembered from this collection's previous run, if any. */
export function getRememberedMembers(ruleId: string, sectionKey: string, collectionName: string): ChangesetMember[] {
  const row = db
    .select({ members: ruleCollectionMembers.members })
    .from(ruleCollectionMembers)
    .where(
      and(
        eq(ruleCollectionMembers.ruleId, ruleId),
        eq(ruleCollectionMembers.sectionKey, sectionKey),
        eq(ruleCollectionMembers.collectionName, collectionName),
      ),
    )
    .get();
  return row?.members ?? [];
}

export interface RecordChangesInput {
  runId: string;
  ruleId: string;
  sectionKey: string;
  sectionTitle: string;
  collectionName: string;
  collectionRatingKey: string | null;
  members: ChangesetMember[];
}

/**
 * Diff this commit against what was remembered, write the changeset, and
 * replace the snapshot. Returns the diff so the caller can log it.
 *
 * A collection appearing for the first time records every item as "added" —
 * which is right: from the rule's point of view they all just arrived. The
 * alternative, suppressing the first run, makes a new rule's most interesting
 * run the one run you can't inspect.
 */
export function recordCollectionChanges(input: RecordChangesInput): CollectionDiff {
  const before = getRememberedMembers(input.ruleId, input.sectionKey, input.collectionName);
  const diff = diffMembers(before, input.members);
  const now = Date.now();

  const rows = [
    ...diff.added.map((m) => ({ member: m, change: "added" as const })),
    ...diff.removed.map((m) => ({ member: m, change: "removed" as const })),
  ].map(({ member, change }) => ({
    runId: input.runId,
    ruleId: input.ruleId,
    sectionKey: input.sectionKey,
    sectionTitle: input.sectionTitle,
    collectionName: input.collectionName,
    collectionRatingKey: input.collectionRatingKey,
    itemRatingKey: member.ratingKey,
    itemTitle: member.title,
    change,
    at: now,
  }));

  if (rows.length > 0) db.insert(ruleRunChanges).values(rows).run();

  db.insert(ruleCollectionMembers)
    .values({
      ruleId: input.ruleId,
      sectionKey: input.sectionKey,
      collectionName: input.collectionName,
      members: input.members,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ruleCollectionMembers.ruleId, ruleCollectionMembers.sectionKey, ruleCollectionMembers.collectionName],
      set: { members: input.members, updatedAt: now },
    })
    .run();

  return diff;
}

export interface RunChangeRow {
  collectionName: string;
  sectionKey: string;
  sectionTitle: string;
  collectionRatingKey: string | null;
  itemRatingKey: string;
  itemTitle: string;
  change: ChangeKind;
}

export interface RunChangeGroup {
  collectionName: string;
  sectionKey: string;
  sectionTitle: string;
  collectionRatingKey: string | null;
  added: Array<{ ratingKey: string; title: string }>;
  removed: Array<{ ratingKey: string; title: string }>;
}

/** Every change one run made, grouped by the collection it happened to. */
export function getRunChanges(runId: string): RunChangeGroup[] {
  const rows = db
    .select({
      collectionName: ruleRunChanges.collectionName,
      sectionKey: ruleRunChanges.sectionKey,
      sectionTitle: ruleRunChanges.sectionTitle,
      collectionRatingKey: ruleRunChanges.collectionRatingKey,
      itemRatingKey: ruleRunChanges.itemRatingKey,
      itemTitle: ruleRunChanges.itemTitle,
      change: sql<ChangeKind>`${ruleRunChanges.change}`,
    })
    .from(ruleRunChanges)
    .where(eq(ruleRunChanges.runId, runId))
    .orderBy(ruleRunChanges.collectionName, ruleRunChanges.itemTitle)
    .all();

  return groupRunChanges(rows);
}

/** Pure half of `getRunChanges`, so the grouping is testable on its own. */
export function groupRunChanges(rows: readonly RunChangeRow[]): RunChangeGroup[] {
  const groups = new Map<string, RunChangeGroup>();
  for (const row of rows) {
    const key = `${row.sectionTitle}\u0000${row.collectionName}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        collectionName: row.collectionName,
        sectionKey: row.sectionKey,
        sectionTitle: row.sectionTitle,
        collectionRatingKey: row.collectionRatingKey,
        added: [],
        removed: [],
      };
      groups.set(key, group);
    }
    // The rating key is only useful if it's still the live one; the last row
    // written for a collection carries the key from the most recent commit.
    if (row.collectionRatingKey) group.collectionRatingKey = row.collectionRatingKey;
    const entry = { ratingKey: row.itemRatingKey, title: row.itemTitle };
    if (row.change === "added") group.added.push(entry);
    else group.removed.push(entry);
  }
  return [...groups.values()];
}

/** Totals for a run, cheap enough to ask for on a list of runs. */
export function getRunChangeCounts(runIds: readonly string[]): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>();
  if (runIds.length === 0) return counts;

  const rows = db
    .select({
      runId: ruleRunChanges.runId,
      change: sql<ChangeKind>`${ruleRunChanges.change}`,
      n: sql<number>`count(*)`,
    })
    .from(ruleRunChanges)
    .where(inArray(ruleRunChanges.runId, [...runIds]))
    .groupBy(ruleRunChanges.runId, ruleRunChanges.change)
    .all();

  for (const row of rows) {
    const entry = counts.get(row.runId) ?? { added: 0, removed: 0 };
    if (row.change === "added") entry.added = row.n;
    else entry.removed = row.n;
    counts.set(row.runId, entry);
  }
  return counts;
}

/**
 * Forget a reverted run's changeset.
 *
 * Called after a revert has been applied to Plex: the run's changes are no
 * longer the truth about what the collection contains, and leaving them would
 * let the same revert be applied twice.
 */
export function clearRunChanges(runId: string): void {
  db.delete(ruleRunChanges).where(eq(ruleRunChanges.runId, runId)).run();
}

/**
 * Overwrite the remembered membership without recording a changeset. Used by
 * revert, which has just made Plex match `members` and must not have its own
 * write show up as the next run's "change".
 */
export function rememberMembers(
  ruleId: string,
  sectionKey: string,
  collectionName: string,
  members: ChangesetMember[],
): void {
  const now = Date.now();
  db.insert(ruleCollectionMembers)
    .values({ ruleId, sectionKey, collectionName, members, updatedAt: now })
    .onConflictDoUpdate({
      target: [ruleCollectionMembers.ruleId, ruleCollectionMembers.sectionKey, ruleCollectionMembers.collectionName],
      set: { members, updatedAt: now },
    })
    .run();
}

/**
 * Drop changesets older than the retention window.
 *
 * Runs themselves are pruned per-rule by count (`RULE_RUN_KEEP_PER_RULE`);
 * changesets are pruned by age instead, because their size tracks how much
 * churn a library has rather than how many runs it did.
 */
export function pruneRunChanges(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  const result = db.delete(ruleRunChanges).where(lt(ruleRunChanges.at, cutoff)).run();
  return result.changes ?? 0;
}

/** The most recent run of a rule that recorded any change at all. */
export function getLatestChangedRunId(ruleId: string): string | null {
  const row = db
    .select({ runId: ruleRunChanges.runId })
    .from(ruleRunChanges)
    .where(eq(ruleRunChanges.ruleId, ruleId))
    .orderBy(desc(ruleRunChanges.at))
    .limit(1)
    .get();
  return row?.runId ?? null;
}
