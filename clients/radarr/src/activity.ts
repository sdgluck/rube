/**
 * Queue, history, releases, calendar, wanted, blocklist.
 *
 * Everything here is **live-proxied and never mirrored**. A stored copy of a
 * download queue is worse than no copy: it looks authoritative and is wrong
 * within seconds. The one exception is history, which is an immutable event
 * log rather than a state snapshot — the sync ingests it into `arr_activity`,
 * but reads still come straight from Radarr so a page is never behind.
 */

import type { ServarrCommand, ServarrHttp } from "@tinkerbell/servarr-http";
import type {
  RadarrBlocklistItem,
  RadarrHistoryRecord,
  RadarrManualImportFile,
  RadarrManualImportItem,
  RadarrMovie,
  RadarrPage,
  RadarrQueueItem,
  RadarrRelease,
} from "./types.ts";

/**
 * An interactive search hits every configured indexer and routinely takes
 * over a minute. It is the one call in the whole client that legitimately
 * needs a deadline this long, and it is never fired without a user asking.
 */
const RELEASE_SEARCH_TIMEOUT_MS = 180_000;

export interface PageOptions {
  page?: number;
  pageSize?: number;
  sortKey?: string;
  sortDirection?: "ascending" | "descending";
}

export interface RemoveFromQueueOptions {
  /** Also tell the download client to drop it. */
  removeFromClient?: boolean;
  /** Add the release to the blocklist so it is not grabbed again. */
  blocklist?: boolean;
  /** Skip the automatic re-search that blocklisting would otherwise trigger. */
  skipRedownload?: boolean;
}

export function createActivity(http: ServarrHttp) {
  return {
    queue(opts: PageOptions & { includeMovie?: boolean } = {}): Promise<RadarrPage<RadarrQueueItem>> {
      const { page = 1, pageSize = 50, sortKey = "timeleft", sortDirection = "ascending", includeMovie = true } = opts;
      return http.get<RadarrPage<RadarrQueueItem>>("/queue", {
        params: { page, pageSize, sortKey, sortDirection, includeMovie, includeUnknownMovieItems: true },
      });
    },

    /**
     * One movie's queue entries, unpaged. What a caller following a single
     * grab needs — paging the whole queue to find one row would make a busy
     * instance the slow path.
     */
    async queueForMovie(movieId: number): Promise<RadarrQueueItem[]> {
      return (await http.get<RadarrQueueItem[]>("/queue/details", { params: { movieId, includeMovie: false } })) ?? [];
    },

    /**
     * The files Radarr would import from a finished download, with its
     * verdict on each. `filterExistingFiles=false`, or a download that is "not
     * an upgrade" for the file on disk lists nothing at all.
     */
    async manualImportCandidates(downloadId: string): Promise<RadarrManualImportItem[]> {
      return (
        // No `movieId`: alongside a path Radarr reads it as "list this movie's
        // own folder" and answers with the file on disk, not the download.
        // Each item names its movie, so the caller filters instead.
        (await http.get<RadarrManualImportItem[]>("/manualimport", {
          params: { downloadId, filterExistingFiles: false },
          timeoutMs: 60_000,
        })) ?? []
      );
    },

    /**
     * Import specific files, regardless of Radarr's own verdict on them.
     *
     * This is how a file Radarr refused as "not an upgrade" gets in: the
     * command imports what it is given, replacing (or recycling) whatever
     * file the movie had. Returns the command, to be polled.
     */
    manualImport(files: RadarrManualImportFile[]): Promise<ServarrCommand> {
      return http.post<ServarrCommand>("/command", { name: "ManualImport", importMode: "auto", files });
    },

    /** Just the counts — what a nav badge needs, without the records. */
    queueStatus(): Promise<{ totalCount: number; count: number; errors: boolean; warnings: boolean }> {
      return http.get("/queue/status");
    },

    removeFromQueue(id: number, opts: RemoveFromQueueOptions = {}): Promise<void> {
      return http.del(`/queue/${id}`, {
        params: {
          removeFromClient: opts.removeFromClient ?? true,
          blocklist: opts.blocklist ?? false,
          skipRedownload: opts.skipRedownload ?? false,
        },
      });
    },

    removeFromQueueBulk(ids: number[], opts: RemoveFromQueueOptions = {}): Promise<void> {
      return http.del("/queue/bulk", {
        body: { ids },
        params: {
          removeFromClient: opts.removeFromClient ?? true,
          blocklist: opts.blocklist ?? false,
          skipRedownload: opts.skipRedownload ?? false,
        },
      });
    },

    history(
      opts: PageOptions & { eventType?: number; includeMovie?: boolean } = {},
    ): Promise<RadarrPage<RadarrHistoryRecord>> {
      const { page = 1, pageSize = 50, sortKey = "date", sortDirection = "descending", includeMovie = true } = opts;
      return http.get<RadarrPage<RadarrHistoryRecord>>("/history", {
        params: { page, pageSize, sortKey, sortDirection, includeMovie, eventType: opts.eventType },
      });
    },

    /**
     * Every history record since a timestamp.
     *
     * The incremental sync's whole basis. Unpaged by design on Radarr's side,
     * so the caller keeps the watermark tight — a first run with a zero
     * watermark would ask for the entire history of the instance.
     */
    async historySince(since: Date, opts: { eventType?: number } = {}): Promise<RadarrHistoryRecord[]> {
      return (
        (await http.get<RadarrHistoryRecord[]>("/history/since", {
          params: { date: since.toISOString(), includeMovie: false, eventType: opts.eventType },
          timeoutMs: 60_000,
        })) ?? []
      );
    },

    async historyForMovie(movieId: number): Promise<RadarrHistoryRecord[]> {
      return (await http.get<RadarrHistoryRecord[]>("/history/movie", { params: { movieId } })) ?? [];
    },

    /** Mark a grab as failed, which un-blocks Radarr to look for another. */
    markHistoryFailed(historyId: number): Promise<void> {
      return http.post(`/history/failed/${historyId}`);
    },

    /** Interactive search. Slow, indexer-hitting, and only ever user-initiated. */
    async releases(movieId: number): Promise<RadarrRelease[]> {
      return (
        (await http.get<RadarrRelease[]>("/release", {
          params: { movieId },
          timeoutMs: RELEASE_SEARCH_TIMEOUT_MS,
          // A search that failed halfway must not be silently repeated: the
          // indexers have already been hit and several will rate-limit.
          retries: 0,
        })) ?? []
      );
    },

    /**
     * Grab a specific release.
     *
     * Takes the release object back verbatim — Radarr matches on the whole
     * payload, not on the guid alone.
     */
    grabRelease(release: RadarrRelease): Promise<void> {
      return http.post("/release", release, { timeoutMs: 60_000 });
    },

    async calendar(start: Date, end: Date, opts: { unmonitored?: boolean } = {}): Promise<RadarrMovie[]> {
      return (
        (await http.get<RadarrMovie[]>("/calendar", {
          params: {
            start: start.toISOString(),
            end: end.toISOString(),
            unmonitored: opts.unmonitored ?? false,
          },
        })) ?? []
      );
    },

    wantedMissing(opts: PageOptions = {}): Promise<RadarrPage<RadarrMovie>> {
      const { page = 1, pageSize = 50, sortKey = "movieMetadata.sortTitle", sortDirection = "ascending" } = opts;
      return http.get<RadarrPage<RadarrMovie>>("/wanted/missing", {
        params: { page, pageSize, sortKey, sortDirection, monitored: true },
      });
    },

    wantedCutoff(opts: PageOptions = {}): Promise<RadarrPage<RadarrMovie>> {
      const { page = 1, pageSize = 50, sortKey = "movieMetadata.sortTitle", sortDirection = "ascending" } = opts;
      return http.get<RadarrPage<RadarrMovie>>("/wanted/cutoff", {
        params: { page, pageSize, sortKey, sortDirection, monitored: true },
      });
    },

    blocklist(opts: PageOptions = {}): Promise<RadarrPage<RadarrBlocklistItem>> {
      const { page = 1, pageSize = 50, sortKey = "date", sortDirection = "descending" } = opts;
      return http.get<RadarrPage<RadarrBlocklistItem>>("/blocklist", {
        params: { page, pageSize, sortKey, sortDirection },
      });
    },

    removeFromBlocklist(id: number): Promise<void> {
      return http.del(`/blocklist/${id}`);
    },

    removeFromBlocklistBulk(ids: number[]): Promise<void> {
      return http.del("/blocklist/bulk", { body: { ids } });
    },
  };
}
