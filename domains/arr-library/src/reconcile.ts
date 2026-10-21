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

import { and, desc, eq, gt, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { arrActivity, arrMovies, arrSeries, mediaItems, type Db } from "@rube/db";
import type { ProblemKind } from "@rube/contracts";

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
  /**
   * For a failed import: the *Arr history ids of every grab of this item that
   * never imported, newest first — what marking it failed acts on.
   */
  grabHistoryIds?: number[];
  /** For an item on disk: its folder, and the *Arr root folder it sits under. */
  path?: string;
  rootFolderPath?: string;
}

/** A cap per issue kind, so one pathological library cannot produce 40k rows. */
const PER_KIND_LIMIT = 200;

/**
 * History events that mean a download became a file. Sonarr and Radarr name
 * their folder imports differently; a name one service never writes matches
 * nothing and costs nothing.
 */
const IMPORT_EVENTS = [
  "downloadFolderImported",
  "episodeFileImported",
  "seriesFolderImported",
  "movieFolderImported",
] as const;

/** History events that mean the *Arr has already dealt with a download that didn't import. */
const SETTLED_EVENTS = ["downloadFailed", "downloadIgnored"] as const;

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
        rootFolderPath: arrMovies.rootFolderPath,
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
        rootFolderPath: arrSeries.rootFolderPath,
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
      path: r.path,
      rootFolderPath: r.rootFolderPath,
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
   * A grab that never became an import, one row per episode or film.
   *
   * `arr_activity` is append-only, so this is a self-join: a `grabbed` event
   * with no later import carrying the same `downloadId`. The download id is
   * what makes it exact rather than a guess about titles.
   *
   * Matching on the download id alone over-reported badly. The usual reason a
   * grab never imports is that it failed, and then the *Arr blocklisted it and
   * a different release imported for the same episode — under a different
   * download id. So a grab also stops counting once:
   *
   * - anything later imported for the same item (`arr_id` is the episode in
   *   Sonarr's history, the film in Radarr's);
   * - its download was marked failed or ignored — the *Arr already knows,
   *   and has already acted on it;
   * - the *Arr no longer has the film or series at all.
   *
   * Grabs newer than the grace window are skipped — something grabbed ten
   * minutes ago has not failed, it is downloading. Several stale grabs of one
   * item are one problem, not several: the fix acts on all of them.
   */
  function failedImports(graceMs = 24 * 60 * 60 * 1000): ArrIssue[] {
    const cutoff = Date.now() - graceMs;
    const rows = db
      .select({
        instanceId: arrActivity.instanceId,
        service: arrActivity.service,
        historyId: arrActivity.arrHistoryId,
        arrId: arrActivity.arrId,
        title: sql<string>`coalesce(
          (select m.title from ${arrMovies} m
            where ${arrActivity.service} = 'radarr' and m.instance_id = ${arrActivity.instanceId} and m.arr_id = ${arrActivity.arrId}),
          (select s.title from ${arrSeries} s
            where ${arrActivity.service} = 'sonarr' and s.instance_id = ${arrActivity.instanceId} and s.arr_id = ${arrActivity.parentArrId}),
          nullif(${arrActivity.title}, ''),
          ${arrActivity.sourceTitle}
        )`,
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
              and later.event_type in (${sql.join(
                [...IMPORT_EVENTS, ...SETTLED_EVENTS].map((e) => sql`${e}`),
                sql`, `,
              )})
              and later.date >= ${arrActivity.date}
          )`,
          sql`(${arrActivity.arrId} = 0 or not exists (
            select 1 from ${arrActivity} later
            where later.instance_id = ${arrActivity.instanceId}
              and later.arr_id = ${arrActivity.arrId}
              and later.event_type in (${sql.join(
                IMPORT_EVENTS.map((e) => sql`${e}`),
                sql`, `,
              )})
              and later.date >= ${arrActivity.date}
          ))`,
          // Still tracked. An id of 0 means the history row didn't say, and
          // is kept rather than guessed away.
          sql`(
            (${arrActivity.service} = 'radarr' and (${arrActivity.arrId} = 0 or exists (
              select 1 from ${arrMovies} m
              where m.instance_id = ${arrActivity.instanceId} and m.arr_id = ${arrActivity.arrId} and m.deleted_at is null
            )))
            or (${arrActivity.service} = 'sonarr' and (${arrActivity.parentArrId} = 0 or exists (
              select 1 from ${arrSeries} s
              where s.instance_id = ${arrActivity.instanceId} and s.arr_id = ${arrActivity.parentArrId} and s.deleted_at is null
            )))
          )`,
        ),
      )
      .orderBy(desc(arrActivity.date))
      .all();

    // Newest first, so the first grab seen for an item is the one the row describes.
    const byItem = new Map<string, { row: (typeof rows)[number]; historyIds: number[] }>();
    for (const row of rows) {
      const itemKey = `${row.instanceId}\u0000${row.arrId || `d:${row.downloadId}`}`;
      const entry = byItem.get(itemKey);
      if (entry) entry.historyIds.push(row.historyId);
      else byItem.set(itemKey, { row, historyIds: [row.historyId] });
    }

    return [...byItem.values()].slice(0, PER_KIND_LIMIT).map(({ row: r, historyIds }) => {
      const when = new Date(r.date).toISOString().slice(0, 10);
      const release = r.sourceTitle && r.sourceTitle !== r.title ? ` as ${r.sourceTitle}` : "";
      const more =
        historyIds.length > 1 ? ` (and ${historyIds.length - 1} earlier grab${historyIds.length > 2 ? "s" : ""})` : "";
      return {
        kind: "failedImport" as const,
        instanceId: r.instanceId,
        service: r.service === "radarr" ? ("radarr" as const) : ("sonarr" as const),
        arrId: r.arrId,
        title: r.title,
        detail: `Grabbed ${when}${release}${more} but never imported`,
        grabHistoryIds: historyIds,
      };
    });
  }

  return { inArrNotInPlex, inPlexNotInArr, duplicateAcrossInstances, failedImports };
}
