/* ─── What Tinkerbell did to your library ───────────────────────────────────
 *
 * Every kind of change this app makes was already recorded, and every one of
 * them was recorded somewhere else: collection membership in `rule_run_changes`,
 * metadata writes in `metadata_originals`, deletions in `cleanup_candidates`,
 * deleted rules in `deleted_rules`, overlay burn-ins in `overlay_originals`.
 * Each has its own page, its own vocabulary and its own idea of a timestamp,
 * and none of them can answer the question anyone actually has after a bad
 * night: *what changed, and can I have it back?*
 *
 * This is a read-model over those five tables. It stores nothing of its own —
 * a sixth ledger duplicating the other five is how the five come to disagree —
 * and it deliberately does not invent an undo for the things that do not have
 * one. A row that says "no undo" is worth more than a row that quietly doesn't
 * have one.
 */

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  cleanupCandidates,
  db,
  deletedRules,
  metadataOriginals,
  overlayOriginals,
  ruleRunChanges,
  rules,
} from "@tinkerbell/db";

export const CHANGE_KINDS = ["collection", "metadata", "cleanup", "rule", "overlay"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * How a change can be taken back.
 *
 * `none` is a first-class answer, not a missing one. A deleted file is gone,
 * and offering an Undo button that opens a dialogue explaining that it isn't
 * really an undo is worse than saying so on the row.
 */
export type UndoKind = "metadata-batch" | "restore-rule" | "none";

export interface ChangeEntry {
  /** Stable within a feed page; a composite of kind and source key. */
  id: string;
  kind: ChangeKind;
  at: number;
  /** The thing that changed, in the user's words. */
  title: string;
  /** What happened to it. */
  detail: string;
  ruleId: string | null;
  ruleName: string | null;
  undo: UndoKind;
  /** What `undo` acts on — a batch id, a rule id. */
  undoRef: string | null;
  /** Where to go for the full story. */
  href: string | null;
  /** Why this can't be undone, when it can't and the reason isn't obvious. */
  irreversibleNote?: string;
}

export interface ChangeFeedOptions {
  /** Newest first, capped. */
  limit?: number;
  /** Only changes at or after this timestamp. */
  since?: number;
  /** Empty means every kind. */
  kinds?: readonly ChangeKind[];
}

/**
 * The merged feed, newest first.
 *
 * Each source is queried with the same `limit` and the results merged and
 * re-cut, rather than trying to express the union in one SQL statement. Five
 * tables with five different shapes and no shared key would be a UNION with
 * five casts per column, and the whole point of the page is to be easy to add
 * a sixth source to.
 */
export function changeFeed(options: ChangeFeedOptions = {}): ChangeEntry[] {
  const { limit = 100, since, kinds } = options;
  const want = (kind: ChangeKind) => !kinds || kinds.length === 0 || kinds.includes(kind);
  const entries: ChangeEntry[] = [];

  if (want("collection")) entries.push(...collectionChanges(limit, since));
  if (want("metadata")) entries.push(...metadataChanges(limit, since));
  if (want("cleanup")) entries.push(...cleanupChanges(limit, since));
  if (want("rule")) entries.push(...ruleChanges(limit, since));
  if (want("overlay")) entries.push(...overlayChanges(limit, since));

  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * Collection membership, one row per item that moved.
 *
 * Not rolled up per collection. "Sci-Fi Gems lost 14 titles" is the summary
 * the rule-runs page already gives; the reason to come here is that one of
 * those fourteen was the one you noticed missing.
 */
function collectionChanges(limit: number, since?: number): ChangeEntry[] {
  const rows = db
    .select({
      id: ruleRunChanges.id,
      runId: ruleRunChanges.runId,
      ruleId: ruleRunChanges.ruleId,
      ruleName: rules.name,
      collectionName: ruleRunChanges.collectionName,
      itemTitle: ruleRunChanges.itemTitle,
      change: ruleRunChanges.change,
      at: ruleRunChanges.at,
    })
    .from(ruleRunChanges)
    .leftJoin(rules, eq(rules.id, ruleRunChanges.ruleId))
    .where(since ? gte(ruleRunChanges.at, since) : undefined)
    .orderBy(desc(ruleRunChanges.at))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: `collection:${row.id}`,
    kind: "collection" as const,
    at: row.at,
    title: row.itemTitle,
    detail: `${row.change === "added" ? "Added to" : "Removed from"} “${row.collectionName}”`,
    ruleId: row.ruleId,
    ruleName: row.ruleName ?? null,
    // A collection is rebuilt from its rule every run, so "undo" means
    // changing the rule — putting one item back by hand lasts until midnight.
    undo: "none" as const,
    undoRef: null,
    href: `/rules/${row.ruleId}/runs?run=${row.runId}`,
    irreversibleNote: "Collections are rebuilt from their rule each run — edit the rule rather than the collection.",
  }));
}

/** Metadata writes, grouped into the batches the undo job works on. */
function metadataChanges(limit: number, since?: number): ChangeEntry[] {
  const rows = db
    .select({
      batchId: metadataOriginals.batchId,
      ruleId: sql<string | null>`max(${metadataOriginals.ruleId})`,
      appliedAt: sql<number>`max(${metadataOriginals.appliedAt})`,
      writes: sql<number>`count(*)`,
      items: sql<number>`count(distinct ${metadataOriginals.ratingKey})`,
      outstanding: sql<number>`sum(case when ${metadataOriginals.revertedAt} is null then 1 else 0 end)`,
      sampleTitle: sql<string>`min(${metadataOriginals.itemTitle})`,
    })
    .from(metadataOriginals)
    .where(since ? gte(metadataOriginals.appliedAt, since) : undefined)
    .groupBy(metadataOriginals.batchId)
    .orderBy(desc(sql`max(${metadataOriginals.appliedAt})`))
    .limit(limit)
    .all();

  const names = ruleNames(rows.map((r) => r.ruleId).filter((id): id is string => id != null));

  return rows.map((row) => ({
    id: `metadata:${row.batchId}`,
    kind: "metadata" as const,
    at: row.appliedAt,
    title: row.items === 1 ? row.sampleTitle : `${row.items} item${row.items === 1 ? "" : "s"}`,
    detail:
      `${row.writes} field write${row.writes === 1 ? "" : "s"}` + (row.outstanding === 0 ? " — already reverted" : ""),
    ruleId: row.ruleId,
    ruleName: row.ruleId ? (names.get(row.ruleId) ?? null) : null,
    // The one thing in the app with a real, tested undo: the previous value of
    // every field was snapshotted before the write.
    undo: row.outstanding === 0 ? ("none" as const) : ("metadata-batch" as const),
    undoRef: row.batchId,
    href: "/metadata",
  }));
}

/**
 * Cleanup actions. The most important rows on the page and the least
 * reversible — which is exactly why they belong here rather than only on a
 * queue somebody visits when they already suspect something.
 */
function cleanupChanges(limit: number, since?: number): ChangeEntry[] {
  const rows = db
    .select({
      ruleId: cleanupCandidates.ruleId,
      ruleName: rules.name,
      ratingKey: cleanupCandidates.ratingKey,
      title: cleanupCandidates.title,
      action: cleanupCandidates.action,
      actionedAt: cleanupCandidates.actionedAt,
    })
    .from(cleanupCandidates)
    .leftJoin(rules, eq(rules.id, cleanupCandidates.ruleId))
    .where(
      since
        ? and(isNotNull(cleanupCandidates.actionedAt), gte(cleanupCandidates.actionedAt, since))
        : isNotNull(cleanupCandidates.actionedAt),
    )
    .orderBy(desc(cleanupCandidates.actionedAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: `cleanup:${row.ruleId}:${row.ratingKey}`,
    kind: "cleanup" as const,
    at: row.actionedAt!,
    title: row.title,
    detail: CLEANUP_PAST[row.action] ?? row.action,
    ruleId: row.ruleId,
    ruleName: row.ruleName ?? null,
    undo: "none" as const,
    undoRef: null,
    href: "/cleanup",
    irreversibleNote:
      row.action === "delete"
        ? "The file is gone. Protect the item so no rule picks it up again."
        : row.action === "unmonitor"
          ? "Re-monitor it in Radarr/Sonarr to undo this."
          : undefined,
  }));
}

const CLEANUP_PAST: Record<string, string> = {
  label: "Labelled for cleanup",
  collection_only: "Added to the cleanup shelf",
  unmonitor: "Unmonitored in Radarr/Sonarr",
  delete: "Deleted, with its files",
};

/** Deleted rules, while their tombstone is still inside the restore window. */
function ruleChanges(limit: number, since?: number): ChangeEntry[] {
  return db
    .select({
      id: deletedRules.id,
      name: deletedRules.name,
      type: deletedRules.type,
      deletedAt: deletedRules.deletedAt,
    })
    .from(deletedRules)
    .where(since ? gte(deletedRules.deletedAt, since) : undefined)
    .orderBy(desc(deletedRules.deletedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: `rule:${row.id}`,
      kind: "rule" as const,
      at: row.deletedAt,
      title: row.name,
      detail: "Rule deleted",
      ruleId: row.id,
      ruleName: row.name,
      undo: "restore-rule" as const,
      undoRef: row.id,
      href: "/rules",
    }));
}

/**
 * Overlay burn-ins.
 *
 * One row per item, recorded when the original poster was saved — which is
 * what makes the burn-in reversible at all. The undo is the `overlays-remove`
 * job rather than a per-item action, so this reports rather than offers.
 */
function overlayChanges(limit: number, since?: number): ChangeEntry[] {
  return db
    .select({
      ratingKey: overlayOriginals.ratingKey,
      sectionId: overlayOriginals.sectionId,
      appliedAt: overlayOriginals.appliedAt,
    })
    .from(overlayOriginals)
    .where(since ? gte(overlayOriginals.appliedAt, since) : undefined)
    .orderBy(desc(overlayOriginals.appliedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: `overlay:${row.ratingKey}`,
      kind: "overlay" as const,
      at: row.appliedAt,
      // No title column: the originals table is keyed by rating key and exists
      // to hold a URL, not to describe an item. Linking to the item is more
      // useful than joining `media_items` for a name that may have been
      // removed from the library since.
      title: `Item ${row.ratingKey}`,
      detail: "Poster overlay applied",
      ruleId: null,
      ruleName: null,
      undo: "none" as const,
      undoRef: null,
      href: `/media/${row.ratingKey}`,
      irreversibleNote: "Run Remove Overlays to put the original posters back across a whole library.",
    }));
}

function ruleNames(ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const rows = db.select({ id: rules.id, name: rules.name }).from(rules).all();
  const wanted = new Set(ids);
  return new Map(rows.filter((r) => wanted.has(r.id)).map((r) => [r.id, r.name]));
}
