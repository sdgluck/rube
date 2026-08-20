/**
 * Pulling a Radarr or Sonarr library into the mirror.
 *
 * The shape of this file is dictated by one API fact: **there is no paged
 * library endpoint**. `GET /movie` and `GET /series` each return everything in
 * a single response. That rules out proxying a unified, sorted, filtered page
 * across four instances, and it also rules out an incremental library walk —
 * a "full sync" here is genuinely full, every time.
 *
 * What keeps that affordable is that it is the only expensive call. History
 * arrives incrementally through `/history/since`, and the volatile things
 * (queue, releases) are never synced at all.
 */

import { and, count, eq, getTableColumns, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  arrMovies,
  arrQualityProfiles,
  arrRootFolders,
  arrSeries,
  arrSyncState,
  arrTags,
  mediaItems,
  type Db,
} from "@tinkerbell/db";
import { createLogger, errorMessage, type ArrInstance } from "@tinkerbell/core";
import { createRadarrClient, capabilitiesFor as radarrCapabilities, type RadarrMovie } from "@tinkerbell/radarr";
import { createSonarrClient, capabilitiesFor as sonarrCapabilities, type SonarrSeries } from "@tinkerbell/sonarr";

const log = createLogger("arr-sync");

/**
 * Rows per INSERT.
 *
 * SQLite's parameter ceiling is 32766. `arr_movies` has ~30 bound columns, so
 * the true limit is around 1000; 500 leaves room for the schema to grow a few
 * columns without anyone rediscovering this the hard way on a 10k library.
 */
const CHUNK = 500;

export interface SyncProgress {
  (done: number, total: number, label: string): void;
}

export interface SyncInstanceResult {
  instanceId: string;
  synced: number;
  tombstoned: number;
  /** Set when the instance could not be reached. The run continues regardless. */
  error?: string;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Seconds or an ISO string to epoch ms. Null for anything unparseable. */
function toMs(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A poster URL safe to hand the browser.
 *
 * Only ever the provider CDN URL. The *Arr's own `/MediaCover/...` path needs
 * the API key to fetch, so storing it would either leak the key to the client
 * or render a broken image — and a broken poster grid looks like a broken sync.
 */
function posterUrl(images: Array<{ coverType?: string; remoteUrl?: string }> | undefined): string {
  const poster = images?.find((i) => i.coverType === "poster");
  return poster?.remoteUrl ?? "";
}

/**
 * The `set` clause for an upsert: "take every column from the row we tried to
 * insert, except the ones that identify it".
 *
 * Built from drizzle's own column metadata rather than by transforming
 * property names into column names by hand. The two spellings differ
 * (`sizeOnDisk` / `size_on_disk`), and a hand-rolled conversion that got one
 * wrong would produce a silently-not-updated column rather than an error.
 */
function excludedSet<T extends SQLiteTable>(table: T, exclude: string[]): Record<string, SQL> {
  const out: Record<string, SQL> = {};
  for (const [prop, column] of Object.entries(getTableColumns(table))) {
    if (exclude.includes(prop)) continue;
    out[prop] = sql.raw(`excluded."${column.name}"`);
  }
  return out;
}

export interface ArrLibrarySyncDeps {
  db: Db;
}

export function createArrLibrarySync(deps: ArrLibrarySyncDeps) {
  const { db } = deps;

  /**
   * Link mirror rows to Plex rows by provider id.
   *
   * Done in SQL rather than row-by-row: it is two indexed correlated updates
   * over the whole instance, against `media_items.tmdb_id`/`tvdb_id` — the
   * columns that exist for exactly this. A null result is not a failure; a
   * movie Radarr has and Plex has never scanned is the most useful thing
   * reconciliation finds.
   *
   * Returns how many of the instance's records now carry a link. Not the
   * update's own `changes` — that counts every row the statement touched,
   * including the ones it set back to null, so it reads as a success on an
   * install where nothing matched at all. The count is a second indexed query
   * against `idx_arr_movies_plex_rating_key` and is what lets a caller say
   * "4231 of 4231 unmatched" out loud instead of leaving it to be discovered
   * in the UI.
   */
  function linkToPlex(instanceId: string, service: "radarr" | "sonarr"): number {
    if (service === "radarr") {
      db.run(sql`
        update ${arrMovies}
        set plex_rating_key = (
          select ${mediaItems.ratingKey} from ${mediaItems}
          where (${mediaItems.tmdbId} is not null and ${mediaItems.tmdbId} = ${arrMovies.tmdbId})
             or (${mediaItems.imdbId} is not null and ${mediaItems.imdbId} = ${arrMovies.imdbId})
          limit 1
        )
        where ${arrMovies.instanceId} = ${instanceId}
      `);
      return (
        db
          .select({ n: count() })
          .from(arrMovies)
          .where(
            and(eq(arrMovies.instanceId, instanceId), isNull(arrMovies.deletedAt), isNotNull(arrMovies.plexRatingKey)),
          )
          .get()?.n ?? 0
      );
    }
    db.run(sql`
      update ${arrSeries}
      set plex_rating_key = (
        select ${mediaItems.ratingKey} from ${mediaItems}
        where (${mediaItems.tvdbId} is not null and ${mediaItems.tvdbId} = ${arrSeries.tvdbId})
           or (${mediaItems.imdbId} is not null and ${mediaItems.imdbId} = ${arrSeries.imdbId})
        limit 1
      )
      where ${arrSeries.instanceId} = ${instanceId}
    `);
    return (
      db
        .select({ n: count() })
        .from(arrSeries)
        .where(
          and(eq(arrSeries.instanceId, instanceId), isNull(arrSeries.deletedAt), isNotNull(arrSeries.plexRatingKey)),
        )
        .get()?.n ?? 0
    );
  }

  function movieRow(instanceId: string, m: RadarrMovie, syncedAt: number) {
    return {
      instanceId,
      arrId: m.id,
      title: m.title,
      sortTitle: m.sortTitle ?? "",
      year: m.year ?? null,
      tmdbId: m.tmdbId ?? null,
      imdbId: m.imdbId ?? null,
      monitored: m.monitored,
      hasFile: m.hasFile,
      status: m.status ?? "",
      minimumAvailability: m.minimumAvailability ?? "",
      qualityProfileId: m.qualityProfileId ?? null,
      rootFolderPath: m.rootFolderPath ?? "",
      path: m.path ?? "",
      sizeOnDisk: m.sizeOnDisk ?? null,
      runtime: m.runtime ?? null,
      certification: m.certification ?? "",
      studio: m.studio ?? "",
      genres: m.genres?.length ? m.genres : null,
      tags: m.tags?.length ? m.tags : null,
      fileQuality: m.movieFile?.quality?.quality?.name ?? "",
      fileCustomFormatScore: m.movieFile?.customFormatScore ?? null,
      posterUrl: posterUrl(m.images),
      addedAt: toMs(m.added),
      inCinemas: toMs(m.inCinemas),
      digitalRelease: toMs(m.digitalRelease),
      physicalRelease: toMs(m.physicalRelease),
      syncedAt,
      // A row seen this run is by definition not deleted. Set explicitly so a
      // record that was removed and re-added resurrects rather than staying
      // tombstoned with fresh data, which would be invisible in every list.
      deletedAt: null,
    };
  }

  function seriesRow(instanceId: string, s: SonarrSeries, syncedAt: number) {
    return {
      instanceId,
      arrId: s.id,
      title: s.title,
      sortTitle: s.sortTitle ?? "",
      year: s.year ?? null,
      tvdbId: s.tvdbId ?? null,
      imdbId: s.imdbId ?? null,
      tmdbId: s.tmdbId ?? null,
      monitored: s.monitored,
      status: s.status ?? "",
      seriesType: s.seriesType ?? "",
      network: s.network ?? "",
      seasonFolder: s.seasonFolder ?? true,
      qualityProfileId: s.qualityProfileId ?? null,
      rootFolderPath: s.rootFolderPath ?? "",
      path: s.path ?? "",
      sizeOnDisk: s.statistics?.sizeOnDisk ?? null,
      runtime: s.runtime ?? null,
      certification: s.certification ?? "",
      genres: s.genres?.length ? s.genres : null,
      tags: s.tags?.length ? s.tags : null,
      episodeCount: s.statistics?.episodeCount ?? 0,
      episodeFileCount: s.statistics?.episodeFileCount ?? 0,
      seasons:
        s.seasons?.map((season) => ({
          seasonNumber: season.seasonNumber,
          monitored: season.monitored,
          episodeCount: season.statistics?.episodeCount ?? 0,
          episodeFileCount: season.statistics?.episodeFileCount ?? 0,
          sizeOnDisk: season.statistics?.sizeOnDisk ?? 0,
        })) ?? null,
      posterUrl: posterUrl(s.images),
      addedAt: toMs(s.added),
      nextAiringAt: toMs(s.nextAiring),
      previousAiringAt: toMs(s.previousAiring),
      syncedAt,
      deletedAt: null,
    };
  }

  /**
   * Mark everything this run did not see as gone.
   *
   * A tombstone rather than a `DELETE`, always. A sync that failed halfway
   * must not be able to empty the mirror, `arr_activity` refers to records
   * that may since have been removed, and a record that comes back should
   * resurrect its history rather than start over under a new identity.
   */
  function tombstone(table: typeof arrMovies | typeof arrSeries, instanceId: string, watermark: number): number {
    const res = db
      .update(table)
      .set({ deletedAt: watermark })
      .where(and(eq(table.instanceId, instanceId), lt(table.syncedAt, watermark), isNull(table.deletedAt)))
      .run();
    return res.changes ?? 0;
  }

  /** Mirror the three configuration tables pickers and routing need. */
  async function syncConfigTables(
    instance: ArrInstance,
    client: {
      settings: { qualityProfiles(): Promise<unknown>; rootFolders(): Promise<unknown>; tags(): Promise<unknown> };
    },
    syncedAt: number,
  ): Promise<void> {
    const { id: instanceId } = instance;

    const profiles = (await client.settings.qualityProfiles()) as Array<{
      id: number;
      name: string;
      upgradeAllowed?: boolean;
      cutoff?: number;
    }>;
    db.delete(arrQualityProfiles).where(eq(arrQualityProfiles.instanceId, instanceId)).run();
    for (const rows of chunk(profiles ?? [], CHUNK)) {
      if (rows.length === 0) continue;
      db.insert(arrQualityProfiles)
        .values(
          rows.map((p) => ({
            instanceId,
            arrId: p.id,
            name: p.name,
            upgradeAllowed: p.upgradeAllowed ?? false,
            cutoff: p.cutoff ?? null,
            syncedAt,
          })),
        )
        .run();
    }

    const folders = (await client.settings.rootFolders()) as Array<{
      id: number;
      path: string;
      accessible?: boolean;
      freeSpace?: number;
    }>;
    db.delete(arrRootFolders).where(eq(arrRootFolders.instanceId, instanceId)).run();
    for (const rows of chunk(folders ?? [], CHUNK)) {
      if (rows.length === 0) continue;
      db.insert(arrRootFolders)
        .values(
          rows.map((f) => ({
            instanceId,
            arrId: f.id,
            path: f.path,
            accessible: f.accessible ?? true,
            freeSpace: f.freeSpace ?? null,
            syncedAt,
          })),
        )
        .run();
    }

    const tags = (await client.settings.tags()) as Array<{ id: number; label: string }>;
    db.delete(arrTags).where(eq(arrTags.instanceId, instanceId)).run();
    for (const rows of chunk(tags ?? [], CHUNK)) {
      if (rows.length === 0) continue;
      db.insert(arrTags)
        .values(rows.map((t) => ({ instanceId, arrId: t.id, label: t.label, syncedAt })))
        .run();
    }
  }

  /**
   * Free space on the volume holding the library.
   *
   * The *Arrs report every mount they can see, most of which have nothing to
   * do with media. The one worth showing on an instance card is the one the
   * library actually lives on, so the root folder picks it — falling back to
   * the largest volume when no root folder is known, which is very likely the
   * media one on a box built for this.
   *
   * Never throws: a missing disk figure must not cost the run its sync.
   */
  async function freeSpaceOn(
    client: { system: { diskSpace(): Promise<Array<{ path: string; freeSpace: number; totalSpace: number }>> } },
    rootFolderPath: string | undefined,
  ): Promise<number | null> {
    try {
      const disks = await client.system.diskSpace();
      if (disks.length === 0) return null;
      if (rootFolderPath) {
        const match = disks
          .filter((d) => rootFolderPath.startsWith(d.path))
          // The longest matching mount point is the most specific one: with
          // both `/` and `/mnt/media` reported, a library under the latter
          // should not be measured against the root filesystem.
          .sort((a, b) => b.path.length - a.path.length)[0];
        if (match) return match.freeSpace;
      }
      return disks.reduce((a, b) => (b.totalSpace > a.totalSpace ? b : a)).freeSpace;
    } catch {
      return null;
    }
  }

  /**
   * Sync one instance.
   *
   * Never throws for an unreachable instance. A run covers every configured
   * *Arr, and one box being down must not cost the others their sync — the
   * error is recorded on `arr_sync_state` and reported, which is the same
   * stance `seerr-poll` takes and for the same reason.
   */
  async function syncInstance(
    instance: ArrInstance,
    opts: { signal?: AbortSignal; onProgress?: SyncProgress } = {},
  ): Promise<SyncInstanceResult> {
    const syncedAt = Date.now();
    const { id: instanceId, service } = instance;

    try {
      if (service === "radarr") {
        const client = createRadarrClient({ url: instance.url, apiKey: instance.apiKey, signal: opts.signal });
        const status = await client.system.status();
        const movies = await client.movies();

        let done = 0;
        for (const rows of chunk(movies, CHUNK)) {
          const values = rows.map((m) => movieRow(instanceId, m, syncedAt));
          db.insert(arrMovies)
            .values(values)
            .onConflictDoUpdate({
              target: [arrMovies.instanceId, arrMovies.arrId],
              set: excludedSet(arrMovies, ["instanceId", "arrId"]),
            })
            .run();
          done += rows.length;
          opts.onProgress?.(done, movies.length, instance.name);
        }

        const tombstoned = tombstone(arrMovies, instanceId, syncedAt);
        linkToPlex(instanceId, "radarr");
        await syncConfigTables(instance, client, syncedAt);

        recordState(instanceId, service, {
          arrVersion: status.version,
          capabilities: radarrCapabilities(status.version),
          lastFullSyncAt: syncedAt,
          itemCount: movies.length,
          diskFree: await freeSpaceOn(client, movies[0]?.rootFolderPath),
        });
        return { instanceId, synced: movies.length, tombstoned };
      }

      const client = createSonarrClient({ url: instance.url, apiKey: instance.apiKey, signal: opts.signal });
      const status = await client.system.status();
      const all = await client.allSeries();

      let done = 0;
      for (const rows of chunk(all, CHUNK)) {
        const values = rows.map((s) => seriesRow(instanceId, s, syncedAt));
        db.insert(arrSeries)
          .values(values)
          .onConflictDoUpdate({
            target: [arrSeries.instanceId, arrSeries.arrId],
            set: excludedSet(arrSeries, ["instanceId", "arrId"]),
          })
          .run();
        done += rows.length;
        opts.onProgress?.(done, all.length, instance.name);
      }

      const tombstoned = tombstone(arrSeries, instanceId, syncedAt);
      linkToPlex(instanceId, "sonarr");
      await syncConfigTables(instance, client, syncedAt);

      recordState(instanceId, service, {
        arrVersion: status.version,
        capabilities: sonarrCapabilities(status.version),
        lastFullSyncAt: syncedAt,
        itemCount: all.length,
        diskFree: await freeSpaceOn(client, all[0]?.rootFolderPath),
      });
      return { instanceId, synced: all.length, tombstoned };
    } catch (err) {
      const message = errorMessage(err);
      log.warn(`${instance.name}: sync failed — ${message}`);
      recordState(instanceId, service, { lastError: message, lastErrorAt: Date.now() });
      return { instanceId, synced: 0, tombstoned: 0, error: message };
    }
  }

  function recordState(
    instanceId: string,
    service: string,
    patch: Partial<{
      arrVersion: string;
      capabilities: string[];
      lastFullSyncAt: number;
      lastIncrementalAt: number;
      historyWatermark: number;
      itemCount: number;
      queueCount: number;
      diskFree: number | null;
      lastError: string;
      lastErrorAt: number;
    }>,
  ): void {
    // A successful pass clears the previous error, so a stale failure does not
    // sit on the instance card forever after the box comes back.
    const values = { instanceId, service, lastError: "", ...patch };
    db.insert(arrSyncState).values(values).onConflictDoUpdate({ target: arrSyncState.instanceId, set: values }).run();
  }

  /**
   * Update one mirror row from a fresh upstream response.
   *
   * The alternative to re-syncing after every mutation. A monitor toggle
   * returns the updated record, so the mirror can be corrected from the
   * freshest data that exists rather than from our own guess about what the
   * change did — and a full re-sync for one toggle would be absurd.
   *
   * Deliberately an upsert rather than an update: a record added through
   * Tinkerbell has no mirror row yet, and it should appear in the library
   * immediately rather than at the next scheduled sync.
   */
  function writeThroughMovie(instanceId: string, movie: RadarrMovie): void {
    const values = movieRow(instanceId, movie, Date.now());
    db.insert(arrMovies)
      .values(values)
      .onConflictDoUpdate({
        target: [arrMovies.instanceId, arrMovies.arrId],
        set: excludedSet(arrMovies, ["instanceId", "arrId"]),
      })
      .run();
    linkToPlex(instanceId, "radarr");
  }

  function writeThroughSeries(instanceId: string, series: SonarrSeries): void {
    const values = seriesRow(instanceId, series, Date.now());
    db.insert(arrSeries)
      .values(values)
      .onConflictDoUpdate({
        target: [arrSeries.instanceId, arrSeries.arrId],
        set: excludedSet(arrSeries, ["instanceId", "arrId"]),
      })
      .run();
    linkToPlex(instanceId, "sonarr");
  }

  /**
   * Tombstone records we have just deleted upstream.
   *
   * Same treatment a vanished record gets from the sync, applied immediately
   * so the row leaves every list at once instead of lingering until the next
   * scheduled run.
   */
  function markRemoved(service: "radarr" | "sonarr", instanceId: string, arrIds: number[]): void {
    if (arrIds.length === 0) return;
    const table = service === "radarr" ? arrMovies : arrSeries;
    db.update(table)
      .set({ deletedAt: Date.now() })
      .where(and(eq(table.instanceId, instanceId), inArray(table.arrId, arrIds)))
      .run();
  }

  return {
    syncInstance,
    linkToPlex,
    recordState,
    chunk,
    tombstone,
    writeThroughMovie,
    writeThroughSeries,
    markRemoved,
  };
}
