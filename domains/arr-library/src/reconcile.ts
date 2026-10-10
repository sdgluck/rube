/**
 * What is wrong across the whole stack.
 *
 * This is the part no native UI can do, and it is almost free: once the mirror
 * carries provider ids and `plex_rating_key`, every question below is one
 * indexed query. Radarr cannot answer "is this in Plex?" and Plex cannot
 * answer "is this monitored?", but a join over two local tables answers both.
 *
 * Deliberately read-only and stateless. Nothing here stores an issue — the
 * queries are cheap enough to run on demand, and a stored issue list is
 * another thing that can be stale and wrong.
 */

import { and, eq, gt, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { arrActivity, arrMovies, arrSeries, mediaItems, type Db } from "@tinkerbell/db";
import type { ProblemKind } from "@tinkerbell/contracts";

/** The Problems kinds this module answers. */
export type ArrIssueKind = Extract<
  ProblemKind,
  "inArrNotInPlex" | "inPlexNotInArr" | "duplicateAcrossInstances" | "failedImport"
>;

export interface ArrIssue {
  kind: ArrIssueKind;
  instanceId: string;
  /** Which *Arr the mirror row is from, so a caller can link to it. */
  service?: "radarr" | "sonarr";
  /** The mirror row, where the issue is about one. */
  arrId?: number;
  ratingKey?: string;
  title: string;
  detail: string;
}

/** A cap per issue kind, so one pathological library cannot produce 40k rows. */
const PER_KIND_LIMIT = 200;

export function createArrReconcile(deps: { db: Db }) {
  const { db } = deps;

  /**
   * In a Radarr/Sonarr with a file, but not in Plex.
   *
   * The classic failure: the *Arr imported it, Plex never scanned. Almost
   * always actionable, and invisible from inside either app.
   */
  function inArrNotInPlex(): ArrIssue[] {
    const movies = db
      .select({
        instanceId: arrMovies.instanceId,
        arrId: arrMovies.arrId,
        title: arrMovies.title,
        path: arrMovies.path,
      })
      .from(arrMovies)
      .where(and(isNull(arrMovies.deletedAt), eq(arrMovies.hasFile, true), isNull(arrMovies.plexRatingKey)))
      .limit(PER_KIND_LIMIT)
      .all();

    const series = db
      .select({
        instanceId: arrSeries.instanceId,
        arrId: arrSeries.arrId,
        title: arrSeries.title,
        path: arrSeries.path,
      })
      .from(arrSeries)
      .where(and(isNull(arrSeries.deletedAt), gt(arrSeries.episodeFileCount, 0), isNull(arrSeries.plexRatingKey)))
      .limit(PER_KIND_LIMIT)
      .all();

    return [
      ...movies.map((r) => ({ ...r, service: "radarr" as const })),
      ...series.map((r) => ({ ...r, service: "sonarr" as const })),
    ].map((r) => ({
      kind: "inArrNotInPlex" as const,
      instanceId: r.instanceId,
      service: r.service,
      arrId: r.arrId,
      title: r.title,
      detail: r.path ? `On disk at ${r.path}, but Plex has no matching item` : "On disk, but Plex has no matching item",
    }));
  }

  /**
   * In Plex, managed by no *Arr.
   *
   * Not necessarily a problem — plenty of libraries hold things nobody wants
   * automated — so this is reported as an observation rather than a fault.
   * Only items carrying a provider id are considered: an unmatched Plex item
   * has nothing to join on, and reporting it here would drown the real hits.
   */
  function inPlexNotInArr(): ArrIssue[] {
    const rows = db
      .select({ ratingKey: mediaItems.ratingKey, title: mediaItems.title, type: mediaItems.type })
      .from(mediaItems)
      .where(
        and(
          sql`${mediaItems.type} in ('movie', 'show')`,
          sql`(${mediaItems.tmdbId} is not null or ${mediaItems.tvdbId} is not null or ${mediaItems.imdbId} is not null)`,
          sql`not exists (
            select 1 from ${arrMovies}
            where ${arrMovies.deletedAt} is null
              and (${arrMovies.tmdbId} = ${mediaItems.tmdbId} or ${arrMovies.imdbId} = ${mediaItems.imdbId})
          )`,
          sql`not exists (
            select 1 from ${arrSeries}
            where ${arrSeries.deletedAt} is null
              and (${arrSeries.tvdbId} = ${mediaItems.tvdbId} or ${arrSeries.imdbId} = ${mediaItems.imdbId})
          )`,
        ),
      )
      .limit(PER_KIND_LIMIT)
      .all();

    return rows.map((r) => ({
      kind: "inPlexNotInArr" as const,
      instanceId: "",
      ratingKey: r.ratingKey,
      title: r.title,
      detail: "In Plex, but no Radarr or Sonarr is managing it",
    }));
  }

  /**
   * The same title held by two instances of the same service, both with files.
   *
   * On a deliberate 1080p/4K split this is the intent, not a fault — so the
   * detail says what was found and leaves the judgement to the reader. What
   * makes it worth surfacing is the case nobody intended: the same film
   * quietly occupying disk twice.
   */
  function duplicateAcrossInstances(): ArrIssue[] {
    const rows = db
      .select({
        tmdbId: arrMovies.tmdbId,
        title: sql<string>`min(${arrMovies.title})`.as("title"),
        instances: sql<string>`group_concat(${arrMovies.instanceId})`.as("instances"),
        n: sql<number>`count(*)`.as("n"),
        bytes: sql<number>`sum(coalesce(${arrMovies.sizeOnDisk}, 0))`.as("bytes"),
      })
      .from(arrMovies)
      .where(and(isNull(arrMovies.deletedAt), eq(arrMovies.hasFile, true), isNotNull(arrMovies.tmdbId)))
      .groupBy(arrMovies.tmdbId)
      .having(sql`count(*) > 1`)
      .limit(PER_KIND_LIMIT)
      .all();

    return rows.map((r) => ({
      kind: "duplicateAcrossInstances" as const,
      instanceId: "",
      title: r.title,
      detail: `Held by ${r.n} instances (${r.instances})`,
    }));
  }

  /**
   * A grab that never became an import.
   *
   * `arr_activity` is append-only, so this is a self-join: a `grabbed` event
   * with no later import carrying the same `downloadId`. The download id is
   * what makes it exact rather than a guess about titles.
   *
   * Grabs newer than the grace window are skipped — something grabbed ten
   * minutes ago has not failed, it is downloading.
   */
  function failedImports(graceMs = 24 * 60 * 60 * 1000): ArrIssue[] {
    const cutoff = Date.now() - graceMs;
    const rows = db
      .select({
        instanceId: arrActivity.instanceId,
        arrId: arrActivity.arrId,
        title: arrActivity.title,
        sourceTitle: arrActivity.sourceTitle,
        downloadId: arrActivity.downloadId,
        date: arrActivity.date,
      })
      .from(arrActivity)
      .where(
        and(
          eq(arrActivity.eventType, "grabbed"),
          ne(arrActivity.downloadId, ""),
          sql`${arrActivity.date} < ${cutoff}`,
          sql`not exists (
            select 1 from ${arrActivity} later
            where later.download_id = ${arrActivity.downloadId}
              and later.instance_id = ${arrActivity.instanceId}
              and later.event_type in ('downloadFolderImported', 'episodeFileImported')
              and later.date >= ${arrActivity.date}
          )`,
        ),
      )
      .limit(PER_KIND_LIMIT)
      .all();

    return rows.map((r) => ({
      kind: "failedImport" as const,
      instanceId: r.instanceId,
      arrId: r.arrId,
      title: r.title || r.sourceTitle,
      detail: `Grabbed ${new Date(r.date).toISOString().slice(0, 10)} but never imported`,
    }));
  }

  return { inArrNotInPlex, inPlexNotInArr, duplicateAcrossInstances, failedImports };
}
