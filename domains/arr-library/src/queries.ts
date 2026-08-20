/**
 * Reading the mirror.
 *
 * Every list the UI shows is an indexed SQL query over `arr_movies` /
 * `arr_series`, sorted and paged in SQLite. That is the whole justification
 * for the mirror existing: the *Arrs cannot page, so proxying a unified list
 * across four instances would mean downloading four whole libraries per page
 * view and sorting them in Node.
 */

import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { arrMovies, arrSeries, arrSyncState, type Db } from "@tinkerbell/db";
import type { ArrService } from "@tinkerbell/contracts";

/** Hard ceiling on a page, matching the rest of the app's list procedures. */
const MAX_PAGE_SIZE = 500;

export interface LibraryQuery {
  service: ArrService;
  /** Absent means every instance of the service — the unified page. */
  instanceId?: string;
  search?: string;
  monitored?: boolean;
  /** True: has a file. False: monitored and missing. */
  hasFile?: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  /** True: linked to a Plex row. False: the "downloaded, not in Plex" list. */
  inPlex?: boolean;
  sort?: "title" | "year" | "added" | "size";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface LibraryPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function createArrQueries(deps: { db: Db }) {
  const { db } = deps;

  function movieFilters(q: LibraryQuery): SQL[] {
    const where: SQL[] = [
      // Tombstoned rows are never listed. They exist so history survives a
      // deletion, not so deleted records keep appearing in the library.
      isNull(arrMovies.deletedAt),
    ];
    if (q.instanceId) where.push(eq(arrMovies.instanceId, q.instanceId));
    if (q.search) where.push(like(sql`lower(${arrMovies.title})`, `%${q.search.toLowerCase()}%`));
    if (q.monitored !== undefined) where.push(eq(arrMovies.monitored, q.monitored));
    if (q.hasFile !== undefined) where.push(eq(arrMovies.hasFile, q.hasFile));
    if (q.qualityProfileId !== undefined) where.push(eq(arrMovies.qualityProfileId, q.qualityProfileId));
    if (q.rootFolderPath) where.push(eq(arrMovies.rootFolderPath, q.rootFolderPath));
    if (q.inPlex === true) where.push(isNotNull(arrMovies.plexRatingKey));
    if (q.inPlex === false) where.push(isNull(arrMovies.plexRatingKey));
    return where;
  }

  function seriesFilters(q: LibraryQuery): SQL[] {
    const where: SQL[] = [isNull(arrSeries.deletedAt)];
    if (q.instanceId) where.push(eq(arrSeries.instanceId, q.instanceId));
    if (q.search) where.push(like(sql`lower(${arrSeries.title})`, `%${q.search.toLowerCase()}%`));
    if (q.monitored !== undefined) where.push(eq(arrSeries.monitored, q.monitored));
    // Sonarr has no `hasFile`; presence is "any episode on disk".
    if (q.hasFile === true) where.push(gt(arrSeries.episodeFileCount, 0));
    if (q.hasFile === false) where.push(eq(arrSeries.episodeFileCount, 0));
    if (q.qualityProfileId !== undefined) where.push(eq(arrSeries.qualityProfileId, q.qualityProfileId));
    if (q.rootFolderPath) where.push(eq(arrSeries.rootFolderPath, q.rootFolderPath));
    if (q.inPlex === true) where.push(isNotNull(arrSeries.plexRatingKey));
    if (q.inPlex === false) where.push(isNull(arrSeries.plexRatingKey));
    return where;
  }

  function movieOrder(q: LibraryQuery) {
    const dir = q.direction === "desc" ? desc : asc;
    switch (q.sort) {
      case "year":
        return dir(arrMovies.year);
      case "added":
        return dir(arrMovies.addedAt);
      case "size":
        return dir(arrMovies.sizeOnDisk);
      default:
        // `sortTitle` is what Radarr sorts by — it strips leading articles, so
        // "The Matrix" files under M as a user expects.
        return dir(sql`coalesce(nullif(${arrMovies.sortTitle}, ''), lower(${arrMovies.title}))`);
    }
  }

  function seriesOrder(q: LibraryQuery) {
    const dir = q.direction === "desc" ? desc : asc;
    switch (q.sort) {
      case "year":
        return dir(arrSeries.year);
      case "added":
        return dir(arrSeries.addedAt);
      case "size":
        return dir(arrSeries.sizeOnDisk);
      default:
        return dir(sql`coalesce(nullif(${arrSeries.sortTitle}, ''), lower(${arrSeries.title}))`);
    }
  }

  function library(q: LibraryQuery): LibraryPage<Record<string, unknown>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, q.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    if (q.service === "radarr") {
      const where = and(...movieFilters(q));
      const total = db.select({ n: count() }).from(arrMovies).where(where).get()?.n ?? 0;
      const rows = db.select().from(arrMovies).where(where).orderBy(movieOrder(q)).limit(pageSize).offset(offset).all();
      return { rows, total, page, pageSize };
    }

    const where = and(...seriesFilters(q));
    const total = db.select({ n: count() }).from(arrSeries).where(where).get()?.n ?? 0;
    const rows = db.select().from(arrSeries).where(where).orderBy(seriesOrder(q)).limit(pageSize).offset(offset).all();
    return { rows, total, page, pageSize };
  }

  function movie(instanceId: string, arrId: number) {
    return db
      .select()
      .from(arrMovies)
      .where(and(eq(arrMovies.instanceId, instanceId), eq(arrMovies.arrId, arrId)))
      .get();
  }

  function series(instanceId: string, arrId: number) {
    return db
      .select()
      .from(arrSeries)
      .where(and(eq(arrSeries.instanceId, instanceId), eq(arrSeries.arrId, arrId)))
      .get();
  }

  /**
   * Every mirror row for one title, across every instance.
   *
   * The unified page's grouping, and the answer to "which of my two Radarrs
   * has this". Keyed on provider id rather than title, because two instances
   * disagreeing about a title is common and disagreeing about a TMDb id is not.
   */
  function byExternalId(service: ArrService, ids: { tmdbId?: number; imdbId?: string; tvdbId?: number }) {
    if (service === "radarr") {
      const clauses: SQL[] = [];
      if (ids.tmdbId != null) clauses.push(eq(arrMovies.tmdbId, ids.tmdbId));
      if (ids.imdbId) clauses.push(eq(arrMovies.imdbId, ids.imdbId));
      if (clauses.length === 0) return [];
      return db
        .select()
        .from(arrMovies)
        .where(and(isNull(arrMovies.deletedAt), or(...clauses)))
        .all();
    }
    const clauses: SQL[] = [];
    if (ids.tvdbId != null) clauses.push(eq(arrSeries.tvdbId, ids.tvdbId));
    if (ids.imdbId) clauses.push(eq(arrSeries.imdbId, ids.imdbId));
    if (clauses.length === 0) return [];
    return db
      .select()
      .from(arrSeries)
      .where(and(isNull(arrSeries.deletedAt), or(...clauses)))
      .all();
  }

  /** The instance cards and the nav badge, in one query and no upstream calls. */
  function instanceState(instanceIds?: string[]) {
    const q = db.select().from(arrSyncState);
    return instanceIds ? q.where(inArray(arrSyncState.instanceId, instanceIds)).all() : q.all();
  }

  return { library, movie, series, byExternalId, instanceState };
}
