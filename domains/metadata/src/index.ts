/**
 * The metadata write ledger.
 *
 * Every field Tinkerbell writes to a Plex item is snapshotted here first, so
 * that any write can be handed back. Metadata is the one thing in the app that
 * cannot be regenerated: a collection can be deleted and rebuilt from its rule,
 * but a sort title somebody spent an evening fixing exists in exactly one
 * place, and a rule with a typo can overwrite five thousand of them in a
 * single run.
 *
 * The ordering rule this file exists to enforce: **snapshot, commit, then
 * write**. A row recorded after a successful write leaves a batch that died
 * halfway only partly revertible, which is precisely the batch someone needs
 * to revert. Every function here is synchronous better-sqlite3, so "commit"
 * costs nothing and there is no reason to do it the other way round.
 *
 * `revertedAt` marks a row spent rather than deleting it. Undoing twice is
 * then a no-op instead of a double-revert, and the history stays as the audit
 * trail people read when they notice a title looks wrong.
 */
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, metadataOriginals } from "@tinkerbell/db";

/** How a field is written, and therefore how it is reverted. */
export type MetadataFieldKind = "scalar" | "tag";

export interface MetadataSnapshot {
  ratingKey: string;
  sectionId: string;
  sectionType: string;
  itemTitle: string;
  field: string;
  fieldKind: MetadataFieldKind;
  /** Null when the field was unset. Tag sets arrive as an array. */
  previousValue: string | string[] | null;
  previousLocked: boolean;
  newValue: string | string[] | null;
}

export interface MetadataOriginal {
  id: number;
  batchId: string;
  ruleId: string | null;
  ratingKey: string;
  sectionId: string;
  sectionType: string;
  itemTitle: string;
  field: string;
  fieldKind: string;
  previousValue: string | null;
  previousLocked: number;
  newValue: string | null;
  appliedAt: number;
  revertedAt: number | null;
}

/** A tag set round-trips as JSON; a scalar stays itself. */
function encode(value: string | string[] | null): string | null {
  if (value === null) return null;
  return Array.isArray(value) ? JSON.stringify(value) : value;
}

/**
 * The stored form back to something a caller can write.
 *
 * A tag row whose JSON is unparseable reads as an empty set rather than
 * throwing: the alternative is one corrupt row blocking the revert of every
 * other row in its batch, and an empty set is what the field looked like
 * before Tinkerbell wrote anything at least as often as not.
 */
export function decodeTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Record what a batch is about to overwrite.
 *
 * Called before the Plex write, in its own transaction, so the ledger is
 * durable whether or not the write that follows succeeds.
 */
export function snapshotWrites(
  batchId: string,
  ruleId: string | null,
  snapshots: MetadataSnapshot[],
  now: number = Date.now(),
): void {
  if (snapshots.length === 0) return;
  db.transaction(() => {
    for (const snap of snapshots) {
      db.insert(metadataOriginals)
        .values({
          batchId,
          ruleId,
          ratingKey: snap.ratingKey,
          sectionId: snap.sectionId,
          sectionType: snap.sectionType,
          itemTitle: snap.itemTitle,
          field: snap.field,
          fieldKind: snap.fieldKind,
          previousValue: encode(snap.previousValue),
          previousLocked: snap.previousLocked ? 1 : 0,
          newValue: encode(snap.newValue),
          appliedAt: now,
        })
        .run();
    }
  });
}

/**
 * The rows a batch would revert — newest first, already-reverted ones omitted.
 *
 * Newest-first is a listing order, not a revert order. A batch that wrote the
 * same field twice has two rows and only the older one holds the pre-batch
 * value; picking between them is the caller's job (see `groupForRevert` in the
 * `metadata-undo` command), because it also has to decide what happens to the
 * superseded row.
 */
export function batchRows(batchId: string): MetadataOriginal[] {
  return db
    .select()
    .from(metadataOriginals)
    .where(and(eq(metadataOriginals.batchId, batchId), isNull(metadataOriginals.revertedAt)))
    .orderBy(desc(metadataOriginals.id))
    .all();
}

/** Stamp rows as reverted. Ids, not a batch id: a partial revert is normal. */
export function markReverted(ids: number[], now: number = Date.now()): void {
  if (ids.length === 0) return;
  // SQLite caps host parameters at 999 and a batch can touch a whole library.
  const CHUNK = 400;
  db.transaction(() => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      db.update(metadataOriginals)
        .set({ revertedAt: now })
        .where(inArray(metadataOriginals.id, ids.slice(i, i + CHUNK)))
        .run();
    }
  });
}

export interface MetadataBatch {
  batchId: string;
  ruleId: string | null;
  appliedAt: number;
  /** Field-level writes in the batch. */
  writes: number;
  items: number;
  /** True once every row has been handed back. */
  reverted: boolean;
  /** Distinct fields touched, for a one-line summary. */
  fields: string[];
  /** A few titles, so the row names something recognisable. */
  sampleTitles: string[];
}

/**
 * Batches newest first, for the undo UI.
 *
 * Aggregated in SQL rather than by loading every row: a single batch can be
 * five thousand rows, and the list only ever shows counts and a few titles.
 */
export function listBatches(limit = 50): MetadataBatch[] {
  const rows = db
    .select({
      batchId: metadataOriginals.batchId,
      ruleId: sql<string | null>`max(${metadataOriginals.ruleId})`,
      appliedAt: sql<number>`max(${metadataOriginals.appliedAt})`,
      writes: sql<number>`count(*)`,
      items: sql<number>`count(distinct ${metadataOriginals.ratingKey})`,
      outstanding: sql<number>`sum(case when ${metadataOriginals.revertedAt} is null then 1 else 0 end)`,
      fields: sql<string>`group_concat(distinct ${metadataOriginals.field})`,
    })
    .from(metadataOriginals)
    .groupBy(metadataOriginals.batchId)
    .orderBy(desc(sql`max(${metadataOriginals.appliedAt})`))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    batchId: row.batchId,
    ruleId: row.ruleId,
    appliedAt: row.appliedAt,
    writes: row.writes,
    items: row.items,
    reverted: row.outstanding === 0,
    fields: (row.fields ?? "").split(",").filter(Boolean),
    sampleTitles: sampleTitles(row.batchId),
  }));
}

function sampleTitles(batchId: string, limit = 3): string[] {
  const rows = db
    .selectDistinct({ title: metadataOriginals.itemTitle })
    .from(metadataOriginals)
    .where(eq(metadataOriginals.batchId, batchId))
    .limit(limit)
    .all();
  return rows.map((r) => r.title).filter(Boolean);
}

/** Everything Tinkerbell has written to one item, newest first. */
export function itemHistory(ratingKey: string, limit = 50): MetadataOriginal[] {
  return db
    .select()
    .from(metadataOriginals)
    .where(eq(metadataOriginals.ratingKey, ratingKey))
    .orderBy(desc(metadataOriginals.appliedAt))
    .limit(limit)
    .all();
}

/**
 * How many field writes have landed in the last window.
 *
 * The global ceiling counts from the ledger rather than from a per-run
 * counter, for the reason cleanup learned the hard way: a per-run budget
 * bounds exactly one batch, so an ad-hoc rule run mints itself a fresh full
 * allowance and five rules run by hand grant five. Counting what actually
 * happened holds however the work was started — scheduled, ad-hoc, or after a
 * restart mid-run.
 *
 * Reverted rows still count. They were written; handing them back is a second
 * event, not an erasure of the first, and letting an undo refill the budget
 * would make "undo, retry, undo, retry" an unbounded loop.
 */
export function writesSince(sinceMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(metadataOriginals)
    .where(sql`${metadataOriginals.appliedAt} >= ${sinceMs}`)
    .get();
  return row?.n ?? 0;
}

/** Default window kept before a batch stops being undoable. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Drop batches older than the retention window.
 *
 * Called from `purge-runs` rather than getting its own cleanup job — one
 * sweeper is enough, and a second scheduled job whose only purpose is deleting
 * rows is a thing to forget about rather than a feature.
 */
export function pruneOlderThan(cutoffMs: number): number {
  const res = db.delete(metadataOriginals).where(lt(metadataOriginals.appliedAt, cutoffMs)).run();
  return res.changes;
}
