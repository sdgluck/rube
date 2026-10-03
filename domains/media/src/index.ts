/**
 * Media module — sync Plex media items to local SQLite and query them.
 */

import { eq, and, asc, desc, inArray, lt, notInArray, or, sql, type InferSelectModel } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { mediaItems, likeContains, type Db } from "@tinkerbell/db";
import { imdbId, tmdbId, tvdbId } from "@tinkerbell/core";

import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import { type EventBus } from "@tinkerbell/ports";
import { token } from "@tinkerbell/container";
import { createDuplicates } from "./duplicates.ts";

export type MediaItemRow = InferSelectModel<typeof mediaItems>;

export { recommendKeeper, type DuplicateGroup, type DuplicateItem, type DuplicateReport } from "./duplicates.ts";

interface SyncStats {
  synced: number;
  removed: number;
  /** Items this sync saw for the first time, newest-looking first. */
  added: NewMediaItem[];
}

export interface NewMediaItem {
  ratingKey: string;
  title: string;
  year: number | null;
  type: string;
  sectionTitle: string;
}

/** How many titles to name in the `media.added` message before "and N more". */
const ADDED_SAMPLE_SIZE = 5;

/**
 * Value filters are lists — the Media page's filter controls are multi-selects,
 * so "H.264 or HEVC" is one query rather than two views. An empty or absent
 * list means the filter is off; values within a list are OR-ed, and separate
 * filters are AND-ed.
 */
interface MediaFilters {
  sectionIds?: string[];
  types?: string[];
  search?: string;
  videoResolutions?: string[];
  videoCodecs?: string[];
  audioCodecs?: string[];
  audioChannels?: number[];
  containers?: string[];
  /** Matches an item carrying any of these labels — compared ignoring case, as Plex does. */
  labels?: string[];
  offset?: number;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
}

export interface SyncMediaOptions {
  /**
   * The `syncedAt` watermark to stamp rows with, and the cutoff for the stale
   * sweep at the end.
   *
   * A resumed sync must reuse the *original* run's watermark: rows written by
   * the run that was interrupted already carry it, and a fresh `Date.now()`
   * would make the final sweep delete every one of them.
   */
  syncedAt?: number;
  /** Section keys already synced under this watermark by a previous, interrupted run. */
  skipSectionKeys?: readonly string[];
  /** Called once a section has been fully written, so the caller can checkpoint. */
  onSectionComplete?: (sectionKey: string) => void;
  /**
   * Every section this install manages, whether or not this run covers it.
   *
   * The stale sweep needs both halves of the picture. Within the sections a run
   * *did* walk, anything left under the old watermark is gone from Plex. Outside
   * them, the watermark says nothing — a job configured with
   * `sections: ["Movies"]` (or a narrowed `global_plex_libraries`) never
   * restamps the TV rows, and sweeping on the watermark alone deleted every one
   * of them, taking the Storage panel, Duplicates and any cleanup protection
   * that resolves through a collection with it.
   *
   * So rows are only swept if their section was walked, or if their section
   * isn't managed at all any more — which is how a library deleted in Plex,
   * or dropped from `global_plex_libraries`, still gets cleaned up.
   *
   * Omitted means "the sections passed in are all there are".
   */
  knownSectionKeys?: readonly string[];
}

/**
 * Bytes on disk for one item, across every version and every part.
 *
 * Null rather than 0 when Plex hangs no parts off the item, which is the normal
 * case for a show row: the files belong to its episodes, and the section listing
 * this walks does not descend into them. Zero would be a claim ("this occupies
 * nothing") that a storage total would then happily add up; null is the truth,
 * and every reader of the column treats it as unknown.
 *
 * Show rows are filled in separately, from a second walk at episode level —
 * see `showSizes` in the Plex client and its use below.
 */
function totalPartSize(media: Array<{ Part?: Array<{ size?: number }> }> | undefined): number | null {
  if (!media || media.length === 0) return null;
  let total = 0;
  let seen = false;
  for (const version of media) {
    for (const part of version.Part ?? []) {
      if (typeof part.size === "number") {
        total += part.size;
        seen = true;
      }
    }
  }
  return seen ? total : null;
}

/**
 * Bytes per show for one TV section, or null if Plex wouldn't say.
 *
 * A storage figure is a nicety; the index is not. A library whose episode walk
 * fails — an old server, a section mid-scan, a timeout on a 40,000-episode
 * library — still gets its show rows written, with sizes left unknown exactly
 * as they were before this walk existed. Throwing here would cost the whole
 * sync for a number on one panel.
 */
interface ShowSizeEntry {
  bytes: number;
  episodes: number;
  unsized: number;
}

async function episodeSizes(
  client: PlexClient,
  section: PlexSection,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<Map<string, ShowSizeEntry> | null> {
  try {
    const sizes = await client.showSizes(section.key, (walked, total) => {
      onProgress?.(walked, total, `Measuring ${section.title}...`);
    });
    const byShow = new Map<string, ShowSizeEntry>();
    for (const [showKey, entry] of sizes) {
      // Every episode sizeless means we learned nothing about this show, which
      // is not the same as a show that occupies nothing — leave it unknown.
      if (entry.unsized === entry.episodes) continue;
      // The coverage counts are kept, not dropped: a show with two of four
      // episodes sized carries a real but incomplete total, and the panel that
      // reports it has to be able to say so.
      byShow.set(showKey, { bytes: entry.bytes, episodes: entry.episodes, unsized: entry.unsized });
    }
    return byShow;
  } catch (err) {
    console.warn(`[media] Couldn't measure episodes in ${section.title}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Labels per item for one section, or null if Plex wouldn't say.
 *
 * Read through the label directory rather than off the listing rows, because a
 * real server's section listing carries no `Label` at all — reading it there
 * stored "no labels" for every item and left the Media page's label filter
 * permanently empty. Null on failure, like `episodeSizes`: a label filter is a
 * nicety, and the caller keeps whatever labels it already had.
 */
async function sectionLabels(client: PlexClient, section: PlexSection): Promise<Map<string, string[]> | null> {
  try {
    return await client.itemLabelsBySection(section.key);
  } catch (err) {
    console.warn(`[media] Couldn't read labels in ${section.title}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

const SORT_COLUMNS = {
  title: mediaItems.title,
  section: mediaItems.sectionTitle,
  type: mediaItems.type,
  year: mediaItems.year,
  // Plex omits `addedAt` on some items, and SQLite sorts NULLs last on DESC —
  // so "newest first", the only direction this sort is asked for, puts the
  // items with no date at the end rather than at the top.
  added: mediaItems.addedAt,
  resolution: mediaItems.videoResolution,
  videoCodec: mediaItems.videoCodec,
  audioCodec: mediaItems.audioCodec,
  audioChannels: mediaItems.audioChannels,
  container: mediaItems.container,
  // Like `added`, this is asked for in one direction — biggest first — and
  // SQLite puts the nulls (items of unknown size; see the column note) at the
  // end there.
  size: mediaItems.fileSize,
} as const;

export interface SectionStorage {
  sectionId: string;
  sectionTitle: string;
  /** Bytes across every item in the section whose size is known. */
  bytes: number;
  /** How many items contributed, and how many could not — see `fileSize`. */
  sized: number;
  unsized: number;
  /** Items whose figure is real but incomplete: some episodes had no size. */
  partial: number;
  /** Episodes those partial items couldn't account for. */
  unknownEpisodes: number;
}

export interface MediaDeps {
  db: Db;
  emitEvent: EventBus;
}
export function createMedia(deps: MediaDeps) {
  const duplicates = createDuplicates(deps);
  const { db, emitEvent } = deps;

  /**
   * Announce what a sync found that wasn't there before.
   *
   * One event per sync rather than one per item: a scan that picks up a
   * 40-episode season is one thing that happened, and a channel that gets 40
   * pings for it is a channel someone mutes.
   *
   * Silent on a library's first sync — `existing` empty means every item is
   * "new", and announcing an entire library on the run that first indexed it is
   * noise, not news.
   */
  function announceAdded(added: NewMediaItem[], hadExisting: boolean): void {
    if (!hadExisting || added.length === 0) return;

    const sample = added.slice(0, ADDED_SAMPLE_SIZE).map((i) => (i.year ? `${i.title} (${i.year})` : i.title));
    const more = added.length - sample.length;
    const list = more > 0 ? `${sample.join(", ")} and ${more} more` : sample.join(", ");

    emitEvent("media.added", `${added.length} new item(s): ${list}`, {
      count: added.length,
      titles: sample,
    });
  }

  async function syncMedia(
    client: PlexClient,
    sections: PlexSection[],
    onProgress?: (current: number, total: number, message: string) => void,
    options: SyncMediaOptions = {},
  ): Promise<SyncStats> {
    const now = options.syncedAt ?? Date.now();
    const skip = new Set(options.skipSectionKeys ?? []);
    let synced = 0;

    // One query, held for the duration of the sync, rather than an existence
    // check per item — this loop runs tens of thousands of times on a large
    // library and the whole point is to keep it a single write each.
    //
    // A resumed sync under-reports: items the interrupted run already wrote are
    // in this set and won't be announced again. That is the right trade against
    // re-announcing them, and a sync that survives to the end is the norm.
    const existing = new Set(
      db
        .select({ ratingKey: mediaItems.ratingKey })
        .from(mediaItems)
        .all()
        .map((r) => r.ratingKey),
    );
    const hadExisting = existing.size > 0;
    const added: NewMediaItem[] = [];

    for (const section of sections) {
      if (skip.has(section.key)) continue;

      // A TV section's sizes live one level down, so they need a second walk
      // before the show rows are written — see `episodeSizes`. Movie sections
      // carry their parts in the listing below and skip this entirely.
      const episodeBytes = section.type === "show" ? await episodeSizes(client, section, onProgress) : null;
      const labelsByItem = await sectionLabels(client, section);

      // Reset per section, because the progress bar is per section — see below.
      let sectionSynced = 0;

      for await (const { item, totalSize } of client.allItems(section.key, { includeGuids: true })) {
        const ratingKey = item.ratingKey;
        if (!ratingKey) continue;

        const media = item.Media?.[0];
        const genres = item.Genre?.map((g) => g.tag).filter((tag) => tag.length > 0) ?? [];
        const labels = labelsByItem?.get(ratingKey) ?? [];
        const guids = item.Guid?.map((g) => g.id).filter((id) => id.length > 0) ?? [];
        // The item's own parts where it has them, else what its episodes came to.
        // A show has no parts, so the second term is the only answer for TV; the
        // fallback order matters for the rare item that has both.
        const episodeEntry = episodeBytes?.get(ratingKey);
        const fileSize = totalPartSize(item.Media) ?? episodeEntry?.bytes ?? null;
        const values = {
          ratingKey,
          sectionId: section.key,
          sectionTitle: section.title,
          title: item.title ?? "",
          year: item.year ?? null,
          thumb: item.thumb ?? null,
          type: item.type ?? "",
          addedAt: item.addedAt ?? null,
          // All four come free with the listing this loop is already paging
          // through. An empty genre list is stored as null, not `[]`, so
          // "Plex told us nothing" and "Plex told us none" don't have to be
          // distinguished downstream — neither should exclude an item.
          genres: genres.length > 0 ? genres : null,
          // Left out entirely when the label read failed, so the upsert keeps
          // the labels from the last sync rather than wiping them.
          ...(labelsByItem ? { labels: labels.length > 0 ? labels : null } : {}),
          rating: item.rating ?? item.audienceRating ?? null,
          contentRating: item.contentRating ?? null,
          durationMs: item.duration ?? null,
          videoResolution: media?.videoResolution ?? null,
          videoCodec: media?.videoCodec ?? null,
          audioCodec: media?.audioCodec ?? null,
          audioChannels: media?.audioChannels ?? null,
          container: media?.container ?? null,
          fileSize,
          // Free in the listing this loop is already paging through. Without it
          // "how many episodes" had no answer at all: the sync indexes a section's
          // top-level rows, so there is never an `episode` row to count.
          leafCount: item.leafCount ?? episodeEntry?.episodes ?? null,
          // How much of that `fileSize` is missing, so a partial total can say so
          // rather than passing for a complete one.
          sizeUnknownParts: episodeEntry ? episodeEntry.unsized : null,
          bitrate: media?.bitrate ?? null,
          versionCount: item.Media?.length ?? 1,
          // `includeGuids` rides the listing this loop is already paging
          // through, so the provider ids cost no extra request. They are what
          // links a Plex row to a Radarr/Sonarr record; without them the two
          // libraries can only be compared by title and year, which is not
          // something you delete a file on.
          guids: guids.length > 0 ? guids : null,
          tmdbId: tmdbId({ guids }),
          imdbId: imdbId({ guids }),
          tvdbId: tvdbId({ guids }),
          syncedAt: now,
        };

        db.insert(mediaItems).values(values).onConflictDoUpdate({ target: mediaItems.ratingKey, set: values }).run();
        synced++;

        if (!existing.has(ratingKey)) {
          existing.add(ratingKey);
          added.push({
            ratingKey,
            title: values.title,
            year: values.year,
            type: values.type,
            sectionTitle: section.title,
          });
        }

        if (onProgress) {
          // Per section, both halves: `synced` is cumulative across every section,
          // and `totalSize` is this section's count — so on the third of three
          // libraries the bar reported 300 of 100.
          sectionSynced++;
          onProgress(sectionSynced, totalSize, `Syncing ${section.title}...`);
        }
      }
      options.onSectionComplete?.(section.key);
    }

    // Remove stale entries not seen in this sync — but only where this sync had
    // anything to say. Single statement avoids the race where a concurrent insert
    // lands between the SELECT and DELETE. See `knownSectionKeys`.
    const walkedKeys = sections.map((s) => s.key);
    const managedKeys = [...(options.knownSectionKeys ?? walkedKeys)];
    const result = db
      .delete(mediaItems)
      .where(
        or(
          and(lt(mediaItems.syncedAt, now), inArray(mediaItems.sectionId, walkedKeys)),
          notInArray(mediaItems.sectionId, managedKeys),
        ),
      )
      .run();
    const removed = Number(result.changes ?? 0);

    announceAdded(added, hadExisting);

    return { synced, removed, added };
  }

  /**
   * Bytes per library, plus how much of each library the figure actually covers.
   *
   * The coverage counts are not decoration. Both libraries can now be measured —
   * TV via the episode roll-up the sync does — but neither is guaranteed complete:
   * an unmatched item, a show mid-scan or a library synced before the roll-up
   * existed all leave rows with no size. A total is only as good as what it
   * covers, so callers show the caveat wherever `unsized` is non-zero rather than
   * presenting a partial figure as the whole.
   */
  function getStorageBySection(): SectionStorage[] {
    const rows = db
      .select({
        sectionId: mediaItems.sectionId,
        sectionTitle: mediaItems.sectionTitle,
        bytes: sql<number>`coalesce(sum(${mediaItems.fileSize}), 0)`,
        sized: sql<number>`sum(case when ${mediaItems.fileSize} is null then 0 else 1 end)`,
        unsized: sql<number>`sum(case when ${mediaItems.fileSize} is null then 1 else 0 end)`,
        // Shows whose total is real but short: some episodes were sized and some
        // weren't. Counted separately from `unsized`, because "we know nothing
        // about this" and "we know part of this" are different admissions, and
        // treating the second as complete is what made a half-measured TV library
        // report a total ~50% low with no caveat at all.
        partial: sql<number>`sum(case when ${mediaItems.fileSize} is not null and coalesce(${mediaItems.sizeUnknownParts}, 0) > 0 then 1 else 0 end)`,
        unknownEpisodes: sql<number>`coalesce(sum(case when ${mediaItems.fileSize} is not null then coalesce(${mediaItems.sizeUnknownParts}, 0) else 0 end), 0)`,
      })
      .from(mediaItems)
      .groupBy(mediaItems.sectionId, mediaItems.sectionTitle)
      .all();
    return rows
      .map((r) => ({
        sectionId: r.sectionId,
        sectionTitle: r.sectionTitle,
        bytes: Number(r.bytes ?? 0),
        sized: Number(r.sized ?? 0),
        unsized: Number(r.unsized ?? 0),
        partial: Number(r.partial ?? 0),
        unknownEpisodes: Number(r.unknownEpisodes ?? 0),
      }))
      .sort((a, b) => b.bytes - a.bytes);
  }

  /** Total bytes for a set of items, and how many of them had no known size. */
  function getSizeForItems(ratingKeys: string[]): { bytes: number; sized: number; unsized: number } {
    if (ratingKeys.length === 0) return { bytes: 0, sized: 0, unsized: 0 };
    let bytes = 0;
    let sized = 0;
    let unsized = 0;
    // SQLite caps host parameters at 999, and a cleanup queue can be longer.
    const CHUNK = 400;
    for (let i = 0; i < ratingKeys.length; i += CHUNK) {
      const rows = db
        .select({ fileSize: mediaItems.fileSize })
        .from(mediaItems)
        .where(inArray(mediaItems.ratingKey, ratingKeys.slice(i, i + CHUNK)))
        .all();
      for (const row of rows) {
        if (row.fileSize == null) unsized++;
        else {
          bytes += row.fileSize;
          sized++;
        }
      }
      // Items the queue names but the index has never seen are unknown too.
      unsized += ratingKeys.slice(i, i + CHUNK).length - rows.length;
    }
    return { bytes, sized, unsized };
  }

  /** Distinct "Title (Year)" labels matching a query — for type-ahead pickers. */
  function searchMediaTitles(query: string, limit = 20, sectionKeys: readonly string[] = []): string[] {
    const q = query.trim();
    if (!q) return [];
    // Scoped to the caller's libraries when it names any. The portal passes the
    // sections actually shared with the signed-in user, because a user shared only
    // "Kids Movies" could otherwise search every title on the server.
    const scope =
      sectionKeys.length > 0
        ? and(likeContains(mediaItems.title, q), inArray(mediaItems.sectionId, [...sectionKeys]))
        : likeContains(mediaItems.title, q);
    const rows = db
      .select({ title: mediaItems.title, year: mediaItems.year })
      .from(mediaItems)
      .where(scope)
      .orderBy(asc(mediaItems.title))
      .limit(limit * 2)
      .all();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const label = r.year ? `${r.title} (${r.year})` : r.title;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Every label in the index, once each, for the Media page's filter.
   *
   * Collapsed case-insensitively — the first spelling seen wins — so a library
   * with both "keep" and "Keep" offers one option, which the filter then
   * matches either way.
   */
  function listLabels(): string[] {
    const rows = db.all<{ label: string }>(
      sql`select min(json_each.value) as label from ${mediaItems}, json_each(${mediaItems.labels}) group by lower(json_each.value) order by lower(json_each.value)`,
    );
    return rows.map((r) => r.label);
  }

  /**
   * Write an item's labels into the index after they've been changed in Plex.
   *
   * Without this a bulk relabel on the Media page left the label filter showing
   * the old answer until the next media sync — the edit "didn't take" from
   * where the user was standing. A no-op for an item the index hasn't seen.
   */
  function setItemLabels(ratingKey: string, labels: string[]): void {
    db.update(mediaItems)
      .set({ labels: labels.length > 0 ? labels : null })
      .where(eq(mediaItems.ratingKey, ratingKey))
      .run();
  }

  function getLocalMediaItems(filters: MediaFilters): {
    items: Array<{
      ratingKey: string;
      title: string;
      year?: number;
      thumb?: string;
      type: string;
      addedAt?: number;
      sectionTitle: string;
      videoResolution?: string;
      videoCodec?: string;
      audioCodec?: string;
      audioChannels?: number;
      container?: string;
      fileSize?: number;
      bitrate?: number;
      labels: string[];
    }>;
    total: number;
    offset: number;
    limit: number;
  } {
    const conditions = [];

    /** One selected value stays an `=`; several become an `IN`. */
    const anyOf = <T extends string | number>(column: SQLiteColumn, values: T[] | undefined) => {
      if (!values || values.length === 0) return;
      conditions.push(values.length === 1 ? eq(column, values[0]) : inArray(column, values));
    };

    anyOf(mediaItems.sectionId, filters.sectionIds);
    anyOf(mediaItems.type, filters.types);
    if (filters.search) {
      conditions.push(likeContains(mediaItems.title, filters.search));
    }
    anyOf(mediaItems.videoResolution, filters.videoResolutions);
    anyOf(mediaItems.videoCodec, filters.videoCodecs);
    anyOf(mediaItems.audioCodec, filters.audioCodecs);
    anyOf(mediaItems.audioChannels, filters.audioChannels);
    anyOf(mediaItems.container, filters.containers);
    if (filters.labels && filters.labels.length > 0) {
      // `lower()` on both sides because Plex treats "keep" and "Keep" as one
      // label, and a filter that missed half of them would look like data loss.
      const wanted = filters.labels.map((l) => l.toLowerCase());
      conditions.push(
        sql`exists (select 1 from json_each(${mediaItems.labels}) where lower(json_each.value) in (${sql.join(
          wanted.map((l) => sql`${l}`),
          sql`, `,
        )}))`,
      );
    }

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;

    const sortCol = SORT_COLUMNS[filters.sort as keyof typeof SORT_COLUMNS] ?? mediaItems.title;
    const orderFn = filters.sortDir === "desc" ? desc : asc;

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .where(whereClause)
      .get();
    const total = countResult?.count ?? 0;

    const rows = db
      .select()
      .from(mediaItems)
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(limit)
      .offset(offset)
      .all();

    return {
      items: rows.map((row) => ({
        ratingKey: row.ratingKey,
        title: row.title,
        year: row.year ?? undefined,
        thumb: row.thumb ?? undefined,
        type: row.type,
        addedAt: row.addedAt ?? undefined,
        sectionTitle: row.sectionTitle,
        videoResolution: row.videoResolution ?? undefined,
        videoCodec: row.videoCodec ?? undefined,
        audioCodec: row.audioCodec ?? undefined,
        audioChannels: row.audioChannels ?? undefined,
        container: row.container ?? undefined,
        fileSize: row.fileSize ?? undefined,
        bitrate: row.bitrate ?? undefined,
        labels: row.labels ?? [],
      })),
      total,
      offset,
      limit,
    };
  }

  return {
    ...duplicates,
    syncMedia,
    getStorageBySection,
    getSizeForItems,
    searchMediaTitles,
    getLocalMediaItems,
    listLabels,
    setItemLabels,
  };
}

export type Media = ReturnType<typeof createMedia>;

export const MediaToken = token<Media>("media");
