import type { TrpcDeps } from "./deps.ts";
/**
 * Manual metadata editing, and the undo history behind every write.
 *
 * The manual path is deliberately *not* gated on `metadata_writes_enabled`.
 * That switch exists for the scheduled runs nobody is watching; a person
 * editing one item is looking at the result, and making them find a global
 * setting first would be a gate with no risk behind it.
 *
 * It does still snapshot. Every write goes through the same ledger as a rule's,
 * with its own batch id, so a hand edit shows up in the same history and is
 * undoable the same way.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { METADATA_FIELDS, METADATA_TAG_FIELDS, type MetadataField, type MetadataTagField } from "@tinkerbell/plex";
import { type MetadataSnapshot } from "@tinkerbell/domain.metadata";

import { t, procedure, mapNotConfiguredClient } from "./_base.ts";

const fieldEnum = z.enum(METADATA_FIELDS);
const tagFieldEnum = z.enum(METADATA_TAG_FIELDS);

export function createMetadataRouter(deps: Pick<TrpcDeps, "clients" | "config" | "jobs" | "media" | "metadata">) {
  const { startJob } = deps.jobs;
  const { clients } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { config, metadata } = deps;
  const { getConfig, setConfig } = config;
  const { itemHistory, listBatches, snapshotWrites } = metadata;
  const { setItemLabels } = deps.media;

  const metadataRouter = t.router({
    /** Everything editable on one item, plus what Plex has locked. */
    fields: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
      const client = getPlexClient();
      return client.getItemFields(input.ratingKey);
    }),

    /**
     * Write scalar fields and/or replace tag sets on one item.
     *
     * `lock` is required rather than defaulted, because the two answers mean
     * genuinely different things and the UI has to say which it is doing: a
     * locked field stops receiving agent updates, an unlocked one may be
     * reverted by the next refresh.
     */
    updateFields: procedure
      .input(
        z.object({
          ratingKey: z.string(),
          fields: z.partialRecord(fieldEnum, z.string()).default(() => ({})),
          tags: z.partialRecord(tagFieldEnum, z.array(z.string())).default(() => ({})),
          lock: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        const current = await client.getItemFields(input.ratingKey);
        if (!current.sectionId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Plex did not say which library this item belongs to, so it cannot be edited.",
          });
        }

        const lockedNow = new Set(current.locked);
        const batchId = randomUUID();
        const snapshots: MetadataSnapshot[] = [];

        const base = {
          ratingKey: input.ratingKey,
          sectionId: current.sectionId,
          sectionType: current.sectionType,
          itemTitle: current.title,
        };

        const scalarWrites: Partial<Record<MetadataField, string>> = {};
        for (const [key, value] of Object.entries(input.fields)) {
          const field = key as MetadataField;
          const currentValue = current.fields[field] ?? null;
          if (currentValue === value && lockedNow.has(field) === input.lock) continue;
          scalarWrites[field] = value;
          snapshots.push({
            ...base,
            field,
            fieldKind: "scalar",
            previousValue: currentValue,
            previousLocked: lockedNow.has(field),
            newValue: value,
          });
        }

        const tagWrites: Array<{ field: MetadataTagField; tags: string[] }> = [];
        for (const [key, tags] of Object.entries(input.tags)) {
          const field = key as MetadataTagField;
          const existing = current.tags[field] ?? [];
          if (existing.length === tags.length && existing.every((t, i) => t === tags[i])) continue;
          tagWrites.push({ field, tags });
          snapshots.push({
            ...base,
            field,
            fieldKind: "tag",
            previousValue: existing,
            previousLocked: lockedNow.has(field),
            newValue: tags,
          });
        }

        if (snapshots.length === 0) return { ok: true, batchId: null, writes: 0 };

        // Snapshot, commit, then write — the same ordering the job path uses,
        // so an edit that fails partway is still fully revertible.
        snapshotWrites(batchId, null, snapshots);

        if (Object.keys(scalarWrites).length > 0) {
          await client.updateItemFields(current.sectionId, current.sectionType, input.ratingKey, scalarWrites, {
            lock: input.lock,
            current,
          });
        }
        for (const { field, tags } of tagWrites) {
          await client.setItemTags(current.sectionId, current.sectionType, input.ratingKey, field, tags, {
            lock: input.lock,
          });
          if (field === "label") setItemLabels(input.ratingKey, tags);
        }

        return { ok: true, batchId, writes: snapshots.length };
      }),

    /**
     * Hand fields back to Plex's agents.
     *
     * Not optional, and not buried: being unable to unlock would make every
     * write a one-way door, which is the thing that stops people trying the
     * feature at all.
     */
    unlockFields: procedure
      .input(z.object({ ratingKey: z.string(), fields: z.array(z.string()).min(1) }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        const current = await client.getItemFields(input.ratingKey);
        if (!current.sectionId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Plex did not say which library this item belongs to, so it cannot be edited.",
          });
        }
        await client.unlockItemFields(current.sectionId, current.sectionType, input.ratingKey, input.fields);
        return { ok: true };
      }),

    /** Ask Plex to re-run its agents against one item. */
    refresh: procedure.input(z.object({ ratingKey: z.string() })).mutation(async ({ input }) => {
      await getPlexClient().refreshItem(input.ratingKey);
      return { ok: true };
    }),

    /**
     * Add and/or remove tags across many items at once.
     *
     * Add-and-remove rather than replace, because the caller is holding a
     * selection and not a set of current values: fifty items each have their own
     * labels, and "add Keep to all of these" must not flatten the forty-nine
     * other labels it finds on the way. So each item is read, merged and written
     * individually — slower than one broadcast write, and the only version that
     * is correct.
     *
     * Every write is snapshotted under a single batch id, which is what makes
     * the whole bulk edit one row in the metadata history and one Undo.
     */
    bulkTags: procedure
      .input(
        z.object({
          ratingKeys: z.array(z.string()).min(1).max(500),
          field: tagFieldEnum,
          add: z.array(z.string()).default(() => []),
          remove: z.array(z.string()).default(() => []),
          lock: z.boolean().default(false),
        }),
      )
      .mutation(async ({ input }) => {
        const { add, remove } = input;
        if (add.length === 0 && remove.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to add or remove." });
        }

        const client = getPlexClient();
        const batchId = randomUUID();
        // Case-insensitive, because Plex tags are — "keep" and "Keep" are one
        // tag, and a remove that only matched the exact casing would look broken.
        const removeLower = new Set(remove.map((t) => t.toLowerCase()));

        let changed = 0;
        const failures: Array<{ ratingKey: string; message: string }> = [];

        for (const ratingKey of input.ratingKeys) {
          try {
            const current = await client.getItemFields(ratingKey);
            if (!current.sectionId) {
              failures.push({ ratingKey, message: "Plex did not say which library this item belongs to." });
              continue;
            }

            const existing = current.tags[input.field] ?? [];
            const kept = existing.filter((t) => !removeLower.has(t.toLowerCase()));
            const existingLower = new Set(kept.map((t) => t.toLowerCase()));
            const added = add.filter((t) => !existingLower.has(t.toLowerCase()));
            const next = [...kept, ...added];

            const unchanged = next.length === existing.length && next.every((t, i) => t === existing[i]);
            if (unchanged) continue;

            snapshotWrites(batchId, null, [
              {
                ratingKey,
                sectionId: current.sectionId,
                sectionType: current.sectionType,
                itemTitle: current.title,
                field: input.field,
                fieldKind: "tag",
                previousValue: existing,
                previousLocked: current.locked.includes(input.field),
                newValue: next,
              },
            ]);

            await client.setItemTags(current.sectionId, current.sectionType, ratingKey, input.field, next, {
              lock: input.lock,
            });
            // The Media page filters on the local index, so it has to hear about
            // the edit too — see `setItemLabels`.
            if (input.field === "label") setItemLabels(ratingKey, next);
            changed++;
          } catch (err) {
            failures.push({ ratingKey, message: err instanceof Error ? err.message : "Unknown error" });
          }
        }

        // A batch id is only worth returning if something was written under it.
        return { changed, failures, batchId: changed > 0 ? batchId : null };
      }),

    /**
     * Re-run Plex's agents against many items.
     *
     * Failures are collected rather than thrown: one unmatched item in a
     * selection of fifty should not decide the fate of the other forty-nine.
     */
    bulkRefresh: procedure
      .input(z.object({ ratingKeys: z.array(z.string()).min(1).max(500) }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        let refreshed = 0;
        const failures: Array<{ ratingKey: string; message: string }> = [];
        for (const ratingKey of input.ratingKeys) {
          try {
            await client.refreshItem(ratingKey);
            refreshed++;
          } catch (err) {
            failures.push({ ratingKey, message: err instanceof Error ? err.message : "Unknown error" });
          }
        }
        return { refreshed, failures };
      }),

    /** The daily ceiling's spend, counted exactly as the run budget counts it. */
    capUsage: procedure.query(() => ({ used: metadata.writesInLastDay() })),

    /** Every metadata write Tinkerbell has made, grouped by the run that made it. */
    batches: procedure
      .input(
        z.object({ limit: z.number().int().min(1).max(200).default(50), ruleId: z.string().optional() }).optional(),
      )
      .query(({ input }) => listBatches(input?.limit ?? 50, input?.ruleId)),

    /** What has been written to one item, for the detail page. */
    history: procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => itemHistory(input.ratingKey)),

    /**
     * Start the undo job for one batch.
     *
     * Not done inline: a batch can be thousands of Plex writes, which is a job
     * with a progress bar rather than a request that times out. The batch id
     * goes through a transient config slot because the command runs in a worker
     * thread — the same route `migrate-collections` takes.
     */
    undo: procedure.input(z.object({ batchId: z.string().min(1) })).mutation(async ({ input }) => {
      const pending = getConfig("metadata_undo_pending_batch");
      if (pending) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An undo is already running. Wait for it to finish before starting another.",
        });
      }
      setConfig("metadata_undo_pending_batch", input.batchId);
      return startJob("metadata-undo");
    }),
  });

  return metadataRouter;
}
