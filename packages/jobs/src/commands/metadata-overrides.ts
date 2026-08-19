import { randomUUID } from "node:crypto";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient, isMetadataTagField, type PlexClient } from "@tinkerbell/plex";
import { normaliseTitle, resolveOverride, type ResolverIndex } from "@tinkerbell/domain.metadata-overrides";

import type { CommonJobConfig, JobContext } from "@tinkerbell/core";

/**
 * Write per-item metadata overrides to Plex.
 *
 * Everything here rides on machinery that already existed, deliberately:
 * `snapshotWrites` records what was there first, so an override is undoable
 * through the same Changes screen as any rule-driven write, and the daily write
 * budget still applies. The only genuinely new thing is *matching* — deciding
 * which film an override written as "The Thing (1982)" belongs to.
 *
 * That matching refuses to guess. An override that can't be resolved to exactly
 * one item is recorded as unmatched and left alone, because the failure mode of
 * a wrong guess is writing one film's hand-written summary onto another, which
 * is worse than the override simply not applying.
 */

/** How many items to write in one pass, so a big import can't run for hours. */
const MAX_ITEMS_PER_RUN = 500;

export function createMetadataOverridesCommand(
  deps: Pick<Services, "clients" | "config" | "metadata" | "metadataOverrides">,
) {
  const { plexHealthCallback } = deps.clients;
  const { getConfig } = deps.config;
  const { snapshotWrites } = deps.metadata;
  const { markApplied, markFailed, pendingOverrides } = deps.metadataOverrides;

  /** Index one section by every key an override might match on. */
  async function indexSection(client: PlexClient, sectionKey: string): Promise<ResolverIndex> {
    const items = await client.allItemsWithGuids(sectionKey);
    const index: ResolverIndex = { byImdb: new Map(), byTmdb: new Map(), byTitle: new Map() };

    for (const item of items) {
      for (const guid of item.guids) {
        const imdb = guid.match(/imdb:\/\/(tt\d+)/);
        if (imdb && !index.byImdb.has(imdb[1]!)) index.byImdb.set(imdb[1]!, item.ratingKey);
        const tmdb = guid.match(/tmdb:\/\/(\d+)/);
        if (tmdb && !index.byTmdb.has(Number(tmdb[1]))) index.byTmdb.set(Number(tmdb[1]), item.ratingKey);
      }
      const key = normaliseTitle(item.title);
      const bucket = index.byTitle.get(key);
      const entry = { ratingKey: item.ratingKey, year: item.year };
      if (bucket) bucket.push(entry);
      else index.byTitle.set(key, [entry]);
    }

    return index;
  }

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    ctx.log("tinkerbell metadata-overrides");

    // The same kill switch every other metadata write respects. An import that
    // stored four hundred overrides must not start writing to somebody's
    // library because a job happened to be scheduled.
    if (getConfig("metadata_writes_enabled") !== true) {
      ctx.log("Metadata writing is switched off in Settings — overrides are stored but not applied.");
      return;
    }

    const pending = pendingOverrides();
    if (pending.length === 0) {
      ctx.log("No overrides waiting to be applied.");
      return;
    }

    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    if (!PLEX_TOKEN) {
      ctx.log("Plex token missing — nothing to do.");
      return;
    }
    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    const bySection = new Map<string, typeof pending>();
    for (const row of pending) {
      const list = bySection.get(row.sectionId);
      if (list) list.push(row);
      else bySection.set(row.sectionId, [row]);
    }

    const batchId = randomUUID();
    let written = 0;
    let unmatched = 0;
    let failed = 0;
    let step = 0;

    for (const [sectionId, rows] of bySection) {
      ctx.signal?.throwIfAborted();
      ctx.log(`Indexing section ${sectionId} to match ${rows.length} override(s)…`);

      let index: ResolverIndex;
      try {
        index = await indexSection(client, sectionId);
      } catch (err) {
        ctx.log(`Couldn't read section ${sectionId}: ${(err as Error).message ?? err}`);
        continue;
      }

      for (const row of rows) {
        if (written >= MAX_ITEMS_PER_RUN) break;
        ctx.signal?.throwIfAborted();
        step++;
        ctx.progress(step, pending.length, `Applying "${row.matchTitle}"…`);

        const ratingKey = resolveOverride(index, {
          title: row.matchTitle,
          year: row.matchYear ?? undefined,
          imdb: row.matchImdb ?? undefined,
          tmdb: row.matchTmdb ?? undefined,
        });

        if (!ratingKey) {
          unmatched++;
          markFailed(
            row.id,
            "No single item in this library matched — check the title and year, or add an IMDb id to the override.",
          );
          continue;
        }

        try {
          const current = await client.getItemFields(ratingKey);
          const locked = new Set(current.locked);
          // Typed at the boundary: these are JSON columns, so the row's own
          // types are as good as whatever was written, and everything below
          // hands them to Plex.
          const fields = row.fields as Record<string, string>;
          const tags = row.tags as Record<string, string[]>;

          // Snapshot before writing, always: this is what makes the write
          // undoable, and it has to be committed even if the write then fails.
          const snapshots = [
            ...Object.entries(fields).map(([field, value]) => ({
              ratingKey,
              sectionId,
              sectionType: current.sectionType,
              itemTitle: current.title,
              field,
              fieldKind: "scalar" as const,
              previousValue: current.fields[field as keyof typeof current.fields] ?? null,
              previousLocked: locked.has(field),
              newValue: value,
            })),
            ...Object.entries(tags).map(([field, values]) => ({
              ratingKey,
              sectionId,
              sectionType: current.sectionType,
              itemTitle: current.title,
              field,
              fieldKind: "tag" as const,
              previousValue: current.tags[field as keyof typeof current.tags] ?? null,
              previousLocked: locked.has(field),
              newValue: values,
            })),
          ];
          if (snapshots.length === 0) continue;
          snapshotWrites(batchId, null, snapshots);

          if (Object.keys(fields).length > 0) {
            await client.updateItemFields(sectionId, current.sectionType, ratingKey, fields, {
              lock: true,
              current,
            });
          }
          for (const [field, values] of Object.entries(tags)) {
            // The override store accepts Plex's five tag fields; anything else
            // in a stored row is data we didn't write and shouldn't send.
            if (!isMetadataTagField(field)) continue;
            await client.setItemTags(sectionId, current.sectionType, ratingKey, field, values, { lock: true });
          }

          markApplied(row.id, ratingKey);
          written++;
          ctx.log(`Applied "${row.matchTitle}" → ${current.title}.`);
        } catch (err) {
          failed++;
          markFailed(row.id, (err as Error).message ?? String(err));
          ctx.log(`Failed on "${row.matchTitle}": ${(err as Error).message ?? err}`);
        }
      }
    }

    ctx.log(`Applied ${written} override(s). ${unmatched} unmatched, ${failed} failed.`);
    if (written >= MAX_ITEMS_PER_RUN) {
      ctx.log(`Stopped at this run's ceiling of ${MAX_ITEMS_PER_RUN} — run again to continue.`);
    }
    if (written > 0) ctx.log(`Undo this batch from Changes (batch ${batchId}).`);
  }

  return { run };
}

export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createMetadataOverridesCommand>["run"]>[1],
): Promise<void> {
  return createMetadataOverridesCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
