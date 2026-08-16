/**
 * Hand one batch of metadata writes back.
 *
 * The counterpart to the metadata action, and the reason that action is
 * tolerable at all. A batch is thousands of Plex writes, so this is a job
 * rather than a request — the batch id arrives through a transient config
 * slot, the same plumbing `migrate-collections` uses to reach a worker thread.
 *
 * Two things it has to restore, not one. The *value*, obviously. And the
 * *lock state*, because putting the old text back while leaving the field
 * locked hands back a field Plex has stopped maintaining — a revert that isn't
 * one. Rows are therefore grouped by their previous lock state, not only by
 * item.
 *
 * A field that was previously unset is a case with no exact inverse: Plex has
 * no "forget this value" verb. The closest honest thing is to clear it and
 * unlock it, so the next agent refresh refills it from the source it would
 * have used before Tinkerbell ever wrote. That is what happens, and the log
 * says so.
 */
import { createPlexClient } from "@tinkerbell/plex";
import { deleteConfig, errorMessage, getConfig, plexHealthCallback } from "@tinkerbell/core";
import type { CommonJobConfig, JobContext } from "@tinkerbell/core";
import { batchRows, decodeTags, markReverted, type MetadataOriginal } from "@tinkerbell/domain.metadata";

/** One PUT's worth of restoration: same item, same intended lock state. */
interface RevertGroup {
  ratingKey: string;
  sectionId: string;
  sectionType: string;
  itemTitle: string;
  locked: boolean;
  /** Rows this group writes. */
  rows: MetadataOriginal[];
  /**
   * Rows for a field an earlier row in the batch already restores. Nothing to
   * write for them, but they are still stamped when this group succeeds — they
   * describe the same field and are just as reverted.
   */
  superseded: MetadataOriginal[];
}

export default async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
  ctx.log("tinkerbell metadata-undo");

  const batchId = getConfig("metadata_undo_pending_batch");
  if (!batchId) {
    ctx.log("No batch selected for undo — nothing to do.");
    return;
  }

  const rows = batchRows(batchId);
  if (rows.length === 0) {
    // Either it was never written, or it has already been handed back.
    // Undoing twice is a no-op, not a double-revert.
    ctx.log(`Batch ${batchId} has nothing left to revert.`);
    deleteConfig("metadata_undo_pending_batch");
    return;
  }

  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
    onHealth: plexHealthCallback,
  });

  ctx.log(`Reverting ${rows.length} field write(s) across ${new Set(rows.map((r) => r.ratingKey)).size} item(s).`);

  const groups = groupForRevert(rows);
  const reverted: number[] = [];
  let failed = 0;
  let done = 0;

  for (const group of groups) {
    ctx.signal?.throwIfAborted();
    try {
      await revertGroup(ctx, client, group);
      reverted.push(...groupRowIds(group));
    } catch (err) {
      // One item failing must not abandon the rest — and its rows stay
      // un-reverted, so running undo again picks them up.
      failed += groupRowIds(group).length;
      ctx.log(`Failed to revert "${group.itemTitle}" — ${errorMessage(err)}`);
    }
    done++;
    ctx.progress(done, groups.length, `Reverted ${done}/${groups.length}`);
  }

  // Stamped only for what actually landed. A row marked reverted that wasn't
  // is a write nobody can undo any more.
  markReverted(reverted);

  deleteConfig("metadata_undo_pending_batch");
  ctx.log(
    failed > 0
      ? `Reverted ${reverted.length} field write(s); ${failed} could not be reverted and remain undoable.`
      : `Reverted ${reverted.length} field write(s).`,
  );
}

/**
 * Split the batch into one PUT per (item, intended lock state).
 *
 * A field written twice in one batch — a rule covering two sections can do
 * that — has two rows, and only the *oldest* one holds the value that was
 * there before the batch started. The newer one records the value the first
 * write had just made, so reverting to it would restore a state that only ever
 * existed mid-run. `batchRows` returns newest-first, so the oldest row per
 * field is the last one seen; the superseded rows are still stamped, because
 * they describe the same field and are just as reverted.
 */
function groupForRevert(rows: MetadataOriginal[]): RevertGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, RevertGroup>();

  const groupFor = (row: MetadataOriginal): RevertGroup => {
    const key = `${row.ratingKey} ${row.previousLocked}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created: RevertGroup = {
      ratingKey: row.ratingKey,
      sectionId: row.sectionId,
      sectionType: row.sectionType,
      itemTitle: row.itemTitle,
      locked: row.previousLocked === 1,
      rows: [],
      superseded: [],
    };
    groups.set(key, created);
    return created;
  };

  // Oldest first, so the row that carries the pre-batch value wins.
  for (const row of [...rows].reverse()) {
    const fieldKey = `${row.ratingKey} ${row.field}`;
    const group = groupFor(row);
    if (seen.has(fieldKey)) group.superseded.push(row);
    else group.rows.push(row);
    seen.add(fieldKey);
  }

  return [...groups.values()];
}

/** Every row a successful revert of this group accounts for. */
function groupRowIds(group: RevertGroup): number[] {
  return [...group.rows, ...group.superseded].map((r) => r.id);
}

async function revertGroup(
  ctx: JobContext,
  client: ReturnType<typeof createPlexClient>,
  group: RevertGroup,
): Promise<void> {
  const scalars = group.rows.filter((r) => r.fieldKind === "scalar");
  const tags = group.rows.filter((r) => r.fieldKind === "tag");

  // Fields that had no value before. Plex has no "forget this" verb, so they
  // are cleared and unlocked — the next agent refresh refills them from
  // whatever source they came from originally.
  const previouslyUnset = scalars.filter((r) => r.previousValue === null);
  const restorable = scalars.filter((r) => r.previousValue !== null);

  if (restorable.length > 0) {
    const fields = Object.fromEntries(restorable.map((r) => [r.field, r.previousValue!]));
    await client.updateItemFields(group.sectionId, group.sectionType, group.ratingKey, fields, {
      lock: group.locked,
    });
    for (const row of restorable) {
      ctx.log(`  "${group.itemTitle}" ${row.field}: restored ${JSON.stringify(row.previousValue)}`);
    }
  }

  if (previouslyUnset.length > 0) {
    await client.updateItemFields(
      group.sectionId,
      group.sectionType,
      group.ratingKey,
      Object.fromEntries(previouslyUnset.map((r) => [r.field, ""])),
      { lock: false },
    );
    await client.unlockItemFields(
      group.sectionId,
      group.sectionType,
      group.ratingKey,
      previouslyUnset.map((r) => r.field),
    );
    for (const row of previouslyUnset) {
      ctx.log(`  "${group.itemTitle}" ${row.field}: cleared and handed back to Plex (it had no value before)`);
    }
  }

  for (const row of tags) {
    await client.setItemTags(
      group.sectionId,
      group.sectionType,
      group.ratingKey,
      row.field as "genre" | "label",
      decodeTags(row.previousValue),
      { lock: group.locked },
    );
    ctx.log(`  "${group.itemTitle}" ${row.field}: restored ${decodeTags(row.previousValue).join(", ") || "(none)"}`);
  }
}
