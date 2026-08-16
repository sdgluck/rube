/**
 * The metadata action: what happens when a rule's ending is "fix these fields"
 * rather than "make a collection".
 *
 * The selection half is unchanged — the same handlers, the same smart filters.
 * All that differs is what the matched set is used for. But unlike a
 * collection, which can be deleted and rebuilt from its rule, metadata cannot
 * be regenerated: a sort title somebody spent an evening fixing exists in
 * exactly one place. So most of this file is refusals and bookkeeping.
 *
 *   - nothing is written unless `metadata_writes_enabled` is on
 *   - nothing is written beyond a per-rule and a global rolling-day ceiling
 *   - nothing is written if the rule suddenly matched an implausible slice of
 *     the library
 *   - nothing is written over a field Plex has locked to a different value,
 *     unless the rule opts in
 *   - nothing is written before its previous value is snapshotted and
 *     committed, so a run that dies halfway is still fully revertible
 *
 * `planWrites` is shared with the preview rather than reimplemented there,
 * which is the only way "change contentRating on 431 items" can be trusted to
 * match what the run then does.
 */
import { randomUUID } from "node:crypto";
import { DAY_MS, errorMessage, getConfig, type JobContext } from "@tinkerbell/core";
import {
  expandTemplate,
  IMPLAUSIBLE_METADATA_FRACTION,
  METADATA_RULE_TAG_FIELDS,
  metadataActionIsEmpty,
  type MetadataActionConfig,
} from "@tinkerbell/contracts";
import { snapshotWrites, writesSince, type MetadataSnapshot } from "@tinkerbell/domain.metadata";
import { emitEvent } from "@tinkerbell/domain.events";
import type { ItemFields, MetadataField, PlexClient, PlexSection } from "@tinkerbell/plex";
import type { HandlerDeps } from "./types.ts";

/** Default ceiling on field writes across every metadata rule, per rolling day. */
export const DEFAULT_MAX_WRITES_PER_DAY = 2000;

/** The window the global ceiling applies over. */
export const BUDGET_WINDOW_MS = DAY_MS;

const KILL_SWITCH_REFUSAL = "metadata writes are disabled globally (Settings → Metadata). One switch stops every rule.";

/**
 * One field this run would change, with everything the preview needs to
 * explain it and everything the writer needs to do it.
 */
export interface PlannedWrite {
  ratingKey: string;
  sectionId: string;
  sectionType: string;
  itemTitle: string;
  field: string;
  kind: "scalar" | "tag";
  currentValue: string | string[] | null;
  newValue: string | string[];
  /** Plex has this field locked. */
  locked: boolean;
  /**
   * Locked to something other than what we'd write, and the rule hasn't opted
   * into `overwriteLocked` — so this one is reported and then skipped.
   */
  blocked: boolean;
}

export interface MatchedItem {
  ratingKey: string;
  sectionId: string;
  sectionType: string;
  title: string;
  /** The collection name the handler yielded this item under, for `{collection}`. */
  collection?: string;
}

/**
 * Work out what a rule would change on one item.
 *
 * Reads the item's current state and compares field by field, because a rule
 * that PUTs 5,000 unchanged items every night is both slow and
 * indistinguishable from one that is broken. No-ops are dropped here rather
 * than counted and skipped later, so a preview's count is the number of things
 * that would actually change.
 */
export function planWrites(action: MetadataActionConfig, item: MatchedItem, current: ItemFields): PlannedWrite[] {
  const planned: PlannedWrite[] = [];
  const locked = new Set(current.locked);
  const ctx = {
    title: current.fields.title ?? item.title,
    year: current.fields.year,
    collection: item.collection,
    studio: current.fields.studio,
  };

  for (const [key, template] of Object.entries(action.set ?? {})) {
    if (typeof template !== "string" || template === "") continue;
    const field = key as MetadataField;
    const value = expandTemplate(template, ctx, { sortLanguages: action.sortLanguages });
    const currentValue = current.fields[field] ?? null;
    // An expansion that comes out empty is dropped rather than written. A
    // token that didn't resolve should leave the field alone, not blank it.
    if (value === "") continue;
    if (currentValue === value && locked.has(field) === action.lock) continue;

    const isLocked = locked.has(field);
    planned.push({
      ratingKey: item.ratingKey,
      sectionId: item.sectionId,
      sectionType: item.sectionType,
      itemTitle: item.title,
      field,
      kind: "scalar",
      currentValue,
      newValue: value,
      locked: isLocked,
      blocked: isLocked && currentValue !== value && !action.overwriteLocked,
    });
  }

  for (const field of METADATA_RULE_TAG_FIELDS) {
    const add = action.addTags?.[field] ?? [];
    const remove = action.removeTags?.[field] ?? [];
    if (add.length === 0 && remove.length === 0) continue;

    const existing = current.tags[field] ?? [];
    const lower = new Set(existing.map((t) => t.toLowerCase()));
    const removeLower = new Set(remove.map((t) => t.toLowerCase()));
    // Plex's tag PUT replaces the whole set, so "add" means read and resend —
    // omitting the rest silently strips every tag the user set by hand.
    const next = existing.filter((t) => !removeLower.has(t.toLowerCase()));
    for (const tag of add) {
      if (lower.has(tag.toLowerCase()) || removeLower.has(tag.toLowerCase())) continue;
      next.push(tag);
    }
    if (next.length === existing.length && next.every((t, i) => t === existing[i])) continue;

    const isLocked = locked.has(field);
    planned.push({
      ratingKey: item.ratingKey,
      sectionId: item.sectionId,
      sectionType: item.sectionType,
      itemTitle: item.title,
      field,
      kind: "tag",
      currentValue: existing,
      newValue: next,
      locked: isLocked,
      // A locked tag set is a curated one. Same rule as a scalar field.
      blocked: isLocked && !action.overwriteLocked,
    });
  }

  return planned;
}

/**
 * The ceiling on field writes, across every rule and every run.
 *
 * Same shape as `CleanupBudget` and for the same reasons: per-rule caps don't
 * compose, rules run concurrently, and reserving happens before the await so
 * eight concurrent rules can't all pass the same check.
 */
export interface MetadataBudget {
  reserve: (n: number) => boolean;
  release: (n: number) => void;
  remaining: () => number;
}

export function createMetadataBudget(now: number = Date.now()): MetadataBudget {
  const ceiling = getConfig("metadata_max_writes_per_day") ?? DEFAULT_MAX_WRITES_PER_DAY;
  const alreadySpent = writesSince(now - BUDGET_WINDOW_MS);
  let reserved = 0;
  return {
    reserve: (n) => {
      if (alreadySpent + reserved + n > ceiling) return false;
      reserved += n;
      return true;
    },
    release: (n) => {
      reserved -= n;
    },
    remaining: () => Math.max(0, ceiling - alreadySpent - reserved),
  };
}

export interface MetadataOutcome {
  matched: number;
  /** Field writes that would change something. */
  planned: number;
  written: number;
  /** Planned writes skipped because the field is locked to something else. */
  blocked: number;
  batchId: string | null;
  refusal?: string;
}

/**
 * Drain the handler, work out every change, and apply whatever survives the
 * guard rails.
 */
export async function runHandlerWithMetadata(
  deps: HandlerDeps,
  action: MetadataActionConfig,
  budget: MetadataBudget,
  handler: (
    deps: HandlerDeps,
  ) => AsyncGenerator<{ name: string; section: PlexSection; matched: Array<{ ratingKey: string; title: string }> }>,
): Promise<MetadataOutcome> {
  const { ctx, client, rule, sections } = deps;

  if (metadataActionIsEmpty(action)) {
    ctx.log(`[metadata] "${rule.name}" sets no fields — nothing to do.`);
    return { matched: 0, planned: 0, written: 0, blocked: 0, batchId: null };
  }

  // 1. Selection, unchanged. De-duplicated by rating key: a grouped rule
  //    yields one group per director and an item belongs to as many as it has
  //    credits, so without this a film is planned, written and *snapshotted*
  //    three times — and the second snapshot records the value the first write
  //    just made, which makes the batch unrevertible.
  const byKey = new Map<string, MatchedItem>();
  for await (const pending of handler(deps)) {
    for (const match of pending.matched) {
      if (byKey.has(match.ratingKey)) continue;
      byKey.set(match.ratingKey, {
        ratingKey: match.ratingKey,
        sectionId: pending.section.key,
        sectionType: pending.section.type,
        title: match.title,
        collection: pending.name,
      });
    }
  }
  const matches = [...byKey.values()];
  ctx.log(`[metadata] "${rule.name}" matched ${matches.length} item(s).`);
  if (matches.length === 0) return { matched: 0, planned: 0, written: 0, blocked: 0, batchId: null };

  // 2. Refusals, cheapest and most categorical first.
  const refusal = await refusalReason(ctx, client, sections, matches.length);
  if (refusal) {
    ctx.log(`[metadata] REFUSING to write: ${refusal}`);
    return { matched: matches.length, planned: 0, written: 0, blocked: 0, batchId: null, refusal };
  }

  // 3. Plan. One read per item, and the reads are what make the plan honest —
  //    everything downstream compares against what is really on the server.
  const planned: PlannedWrite[] = [];
  for (const item of matches) {
    ctx.signal?.throwIfAborted();
    try {
      const current = await client.getItemFields(item.ratingKey);
      planned.push(...planWrites(action, item, current));
    } catch (err) {
      ctx.log(`[metadata] Could not read "${item.title}" — ${errorMessage(err)}`);
    }
    if (planned.length >= action.maxWritesPerRun) break;
  }

  const blocked = planned.filter((p) => p.blocked);
  for (const p of blocked) {
    ctx.log(
      `[metadata] SKIP "${p.itemTitle}" ${p.field}: locked to ${describe(p.currentValue)}` +
        ` and the rule does not overwrite locked fields.`,
    );
  }

  const writable = planned.filter((p) => !p.blocked).slice(0, action.maxWritesPerRun);
  if (writable.length === 0) {
    ctx.log(`[metadata] Nothing to change — every matched field already holds the right value.`);
    return { matched: matches.length, planned: 0, written: 0, blocked: blocked.length, batchId: null };
  }

  if (action.dryRun) {
    ctx.log(`[metadata] DRY RUN — ${writable.length} field write(s) across ${countItems(writable)} item(s):`);
    for (const p of writable.slice(0, 50)) {
      ctx.log(
        `[metadata]   would set "${p.itemTitle}" ${p.field}: ${describe(p.currentValue)} → ${describe(p.newValue)}`,
      );
    }
    if (writable.length > 50) ctx.log(`[metadata]   …and ${writable.length - 50} more.`);
    return { matched: matches.length, planned: writable.length, written: 0, blocked: blocked.length, batchId: null };
  }

  // 4. Write.
  const batchId = randomUUID();
  const written = await applyWrites(deps, action, writable, budget, batchId);

  if (written > 0) {
    emitEvent("metadata.written", `"${rule.name}" changed ${written} field(s) on ${countItems(writable)} item(s)`, {
      ruleId: rule.id,
      ruleName: rule.name,
      batchId,
      count: written,
    });
  }

  return {
    matched: matches.length,
    planned: writable.length,
    written,
    blocked: blocked.length,
    batchId: written > 0 ? batchId : null,
  };
}

/**
 * Snapshot, then write, one item at a time.
 *
 * The ordering is the whole safety property: the ledger row is committed
 * before the PUT goes out, so a batch that dies halfway — or a container that
 * restarts mid-run — is still fully revertible. Doing it the other way round
 * loses exactly the batch someone needs to undo.
 */
async function applyWrites(
  deps: HandlerDeps,
  action: MetadataActionConfig,
  writes: PlannedWrite[],
  budget: MetadataBudget,
  batchId: string,
): Promise<number> {
  const { ctx, client, rule } = deps;

  // Grouped by item so one PUT carries every scalar field that changed on it.
  const byItem = new Map<string, PlannedWrite[]>();
  for (const write of writes) {
    const bucket = byItem.get(write.ratingKey) ?? [];
    bucket.push(write);
    byItem.set(write.ratingKey, bucket);
  }

  let done = 0;
  for (const bucket of byItem.values()) {
    ctx.signal?.throwIfAborted();

    // Reserved before the await, not after success: rules run concurrently
    // and counting only on completion lets every one of them pass the same
    // check with the same remaining budget.
    if (!budget.reserve(bucket.length)) {
      ctx.log(`[metadata] Daily write limit reached — stopping. The rest go on the next run.`);
      break;
    }

    const snapshots: MetadataSnapshot[] = bucket.map((w) => ({
      ratingKey: w.ratingKey,
      sectionId: w.sectionId,
      sectionType: w.sectionType,
      itemTitle: w.itemTitle,
      field: w.field,
      fieldKind: w.kind,
      previousValue: w.currentValue,
      previousLocked: w.locked,
      newValue: w.newValue,
    }));

    try {
      snapshotWrites(batchId, rule.id, snapshots);

      const scalars = bucket.filter((w) => w.kind === "scalar");
      const first = bucket[0];
      if (scalars.length > 0) {
        const fields = Object.fromEntries(scalars.map((w) => [w.field, w.newValue as string]));
        await client.updateItemFields(first.sectionId, first.sectionType, first.ratingKey, fields, {
          lock: action.lock,
        });
      }
      for (const write of bucket.filter((w) => w.kind === "tag")) {
        await client.setItemTags(
          write.sectionId,
          write.sectionType,
          write.ratingKey,
          write.field as "genre" | "label",
          write.newValue as string[],
          { lock: action.lock },
        );
      }

      done += bucket.length;
      // Every write is one line. This log is the audit trail people read when
      // something looks wrong, so it is deliberately per-field rather than a
      // per-item summary.
      for (const write of bucket) {
        ctx.log(
          `[metadata] SET "${write.itemTitle}" ${write.field}: ${describe(write.currentValue)} → ${describe(write.newValue)}`,
        );
      }
    } catch (err) {
      budget.release(bucket.length);
      // The snapshot rows stay. They record an attempt whose outcome is
      // unknown — Plex may have applied some of it — and a revert that
      // restores a value already equal to the current one is harmless, while
      // a missing row is not.
      ctx.log(`[metadata] FAILED on "${bucket[0].itemTitle}" — ${errorMessage(err)}`);
    }
  }

  return done;
}

/**
 * Why this run must not write, or null if it may.
 *
 * No staleness check on the local index, unlike cleanup: nothing here reasons
 * about watch state, and a metadata rule's selection is answered by Plex at
 * run time.
 */
async function refusalReason(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  matchCount: number,
): Promise<string | null> {
  if (!(getConfig("metadata_writes_enabled") ?? false)) return KILL_SWITCH_REFUSAL;

  const total = await sectionItemTotal(ctx, client, sections);
  if (total == null) {
    return "Plex could not be asked how large the library is, so the sanity check on how much this rule matched cannot run.";
  }
  if (total > 0 && matchCount / total > IMPLAUSIBLE_METADATA_FRACTION) {
    const pct = Math.round((matchCount / total) * 100);
    return `it matched ${matchCount} of ${total} items (${pct}%), which reads as a filter mistake rather than an instruction. Nothing was touched.`;
  }
  return null;
}

/**
 * Total items across the rule's sections, or null if we couldn't size any.
 *
 * Null rather than zero for the reason cleanup gives: without a denominator
 * the fraction guard has nothing to compare against, and treating that as "0%
 * matched" would switch the guard off at exactly the moment Plex is least
 * trustworthy.
 */
async function sectionItemTotal(ctx: JobContext, client: PlexClient, sections: PlexSection[]): Promise<number | null> {
  let total = 0;
  let sized = 0;
  for (const section of sections) {
    try {
      total += await client.getSectionItemCount(section.key);
      sized++;
    } catch (err) {
      ctx.log(`[metadata] Could not size "${section.title}" for the sanity check — ${errorMessage(err)}`);
    }
  }
  return sized === 0 ? null : total;
}

function countItems(writes: PlannedWrite[]): number {
  return new Set(writes.map((w) => w.ratingKey)).size;
}

/** A value as it appears in a log line or a diff. */
export function describe(value: string | string[] | null): string {
  if (value === null) return "(unset)";
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.join(", ");
  return value === "" ? "(empty)" : `"${value}"`;
}
