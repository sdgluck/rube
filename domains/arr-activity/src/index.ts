/* ─── What happened to this, and where is it now ────────────────────────────
 *
 * `arr-library` answers "what do my *Arrs hold". This answers "what did they
 * *do*", which is a different question with a different storage shape: an
 * append-only event ledger rather than a mirror of current state, with its own
 * retention and its own consumers.
 *
 * It is the spine of end-to-end traceability. The reason it works at all is
 * `downloadId`: SABnzbd's `nzo_id` and qBittorrent's info hash are the same
 * string the *Arr recorded when it grabbed the release, so joining a grab to a
 * download client's queue entry needs no heuristic about titles. Everything
 * downstream — the timeline, failed-import detection, and eventually the
 * download-client integration — is built on that one column.
 */

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { arrActivity, type Db } from "@rube/db";
import { token } from "@rube/container";
import { createLogger, errorMessage, type ArrInstance } from "@rube/core";
import { createRadarrClient } from "@rube/radarr";
import { createSonarrClient } from "@rube/sonarr";

const log = createLogger("arr-activity");

/**
 * How far back a first ingest reaches.
 *
 * With no watermark, `/history/since` would be asked for the entire history of
 * the instance — years of events on an old install, none of which is
 * actionable. Thirty days is enough to populate a useful timeline and to catch
 * a failed import nobody noticed, and the window only ever applies once.
 */
const FIRST_RUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Retention. Matches `change_log`'s 180 days, for the same "after a bad night" reason. */
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** The keys worth keeping out of a history record's `data` blob. */
const KEPT_DATA_KEYS = [
  "reason",
  "releaseGroup",
  "customFormatScore",
  "importedPath",
  "droppedPath",
  "indexer",
  "size",
];

interface HistoryRow {
  id: number;
  eventType: string;
  sourceTitle?: string;
  date: string;
  downloadId?: string;
  data?: Record<string, string>;
  quality?: { quality?: { name?: string } };
}

function trimData(data: Record<string, string> | undefined): Record<string, string> | null {
  if (!data) return null;
  const out: Record<string, string> = {};
  for (const key of KEPT_DATA_KEYS) {
    if (data[key] !== undefined) out[key] = String(data[key]);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface ArrActivityDeps {
  db: Db;
}

export interface IngestResult {
  instanceId: string;
  ingested: number;
  watermark: number;
  error?: string;
}

export function createArrActivity(deps: ArrActivityDeps) {
  const { db } = deps;

  /**
   * Pull history since the watermark.
   *
   * `arr_history_id` is unique per instance and the insert ignores conflicts,
   * so an overlapping window is harmless — which matters, because the
   * watermark is deliberately rewound by a second below. A history record
   * written in the same millisecond the previous run read up to would
   * otherwise be skipped forever.
   */
  async function ingest(
    instance: ArrInstance,
    watermark: number,
    opts: { signal?: AbortSignal } = {},
  ): Promise<IngestResult> {
    const { id: instanceId, service } = instance;
    const since = new Date(watermark > 0 ? watermark - 1_000 : Date.now() - FIRST_RUN_WINDOW_MS);
    const now = Date.now();

    try {
      const rows: HistoryRow[] = [];
      const parents: Array<number> = [];
      const items: Array<number> = [];
      const titles: string[] = [];

      if (service === "radarr") {
        const client = createRadarrClient({ url: instance.url, apiKey: instance.apiKey, signal: opts.signal });
        const history = await client.historySince(since);
        for (const h of history) {
          rows.push(h as HistoryRow);
          items.push(h.movieId ?? 0);
          parents.push(0);
          titles.push(h.movie?.title ?? "");
        }
      } else {
        const client = createSonarrClient({ url: instance.url, apiKey: instance.apiKey, signal: opts.signal });
        const history = await client.historySince(since);
        for (const h of history) {
          rows.push(h as HistoryRow);
          items.push(h.episodeId ?? 0);
          parents.push(h.seriesId ?? 0);
          titles.push(h.series?.title ?? "");
        }
      }

      if (rows.length === 0) return { instanceId, ingested: 0, watermark };

      let newest = watermark;
      const values = rows.map((h, i) => {
        const date = Date.parse(h.date);
        const ms = Number.isFinite(date) ? date : now;
        if (ms > newest) newest = ms;
        return {
          instanceId,
          service,
          arrHistoryId: h.id,
          eventType: h.eventType,
          arrId: items[i],
          parentArrId: parents[i],
          title: titles[i],
          sourceTitle: h.sourceTitle ?? "",
          quality: h.quality?.quality?.name ?? "",
          indexer: h.data?.indexer ?? "",
          // Radarr stores torrent hashes uppercase and qBittorrent reports them
          // lowercase. Normalising here means the download-client join is a
          // plain equality rather than a per-call-site `lower()` somebody will
          // forget on the one query that matters.
          downloadId: (h.downloadId ?? "").toLowerCase(),
          data: trimData(h.data),
          date: ms,
          syncedAt: now,
        };
      });

      let ingested = 0;
      for (let i = 0; i < values.length; i += 500) {
        const batch = values.slice(i, i + 500);
        const res = db.insert(arrActivity).values(batch).onConflictDoNothing().run();
        ingested += res.changes ?? 0;
      }

      return { instanceId, ingested, watermark: newest };
    } catch (err) {
      const message = errorMessage(err);
      log.warn(`${instance.name}: history ingest failed — ${message}`);
      // The watermark is returned unchanged, so the next run re-reads the same
      // window rather than skipping whatever happened during the outage.
      return { instanceId, ingested: 0, watermark, error: message };
    }
  }

  /** One item's events, newest first. */
  function forItem(instanceId: string, arrId: number, limit = 100) {
    return db
      .select()
      .from(arrActivity)
      .where(and(eq(arrActivity.instanceId, instanceId), eq(arrActivity.arrId, arrId)))
      .orderBy(desc(arrActivity.date))
      .limit(limit)
      .all();
  }

  /** Everything sharing a download id — the grab, the import, the failure. */
  function forDownload(downloadId: string) {
    return db
      .select()
      .from(arrActivity)
      .where(eq(arrActivity.downloadId, downloadId.toLowerCase()))
      .orderBy(desc(arrActivity.date))
      .all();
  }

  /** The global feed. */
  function recent(opts: { instanceIds?: string[]; eventTypes?: string[]; limit?: number } = {}) {
    const where = [];
    if (opts.instanceIds?.length) where.push(inArray(arrActivity.instanceId, opts.instanceIds));
    if (opts.eventTypes?.length) where.push(inArray(arrActivity.eventType, opts.eventTypes));
    return db
      .select()
      .from(arrActivity)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(arrActivity.date))
      .limit(Math.min(500, opts.limit ?? 100))
      .all();
  }

  /** Drop events past the retention window. Called by the purge job. */
  function purge(now = Date.now()): number {
    const res = db
      .delete(arrActivity)
      .where(lt(arrActivity.date, now - RETENTION_MS))
      .run();
    return res.changes ?? 0;
  }

  return { ingest, forItem, forDownload, recent, purge };
}

export type ArrActivity = ReturnType<typeof createArrActivity>;

export const ArrActivityToken = token<ArrActivity>("arrActivity");
