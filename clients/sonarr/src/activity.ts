/**
 * Queue, history, releases, calendar, wanted, blocklist.
 *
 * Everything here is **live-proxied and never mirrored**. A stored copy of a
 * download queue is worse than no copy: it looks authoritative and is wrong
 * within seconds. The one exception is history, which is an immutable event
 * log rather than a state snapshot — the sync ingests it into `arr_activity`,
 * but reads still come straight from Sonarr so a page is never behind.
 */

import type { ServarrHttp } from "@rube/servarr-http";
import type {
  SonarrBlocklistItem,
  SonarrHistoryRecord,
  SonarrEpisode,
  SonarrPage,
  SonarrQueueItem,
  SonarrRelease,
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
    queue(opts: PageOptions & { includeSeries?: boolean } = {}): Promise<SonarrPage<SonarrQueueItem>> {
      const { page = 1, pageSize = 50, sortKey = "timeleft", sortDirection = "ascending", includeSeries = true } = opts;
      return http.get<SonarrPage<SonarrQueueItem>>("/queue", {
        params: {
          page,
          pageSize,
          sortKey,
          sortDirection,
          includeSeries,
          includeEpisode: true,
          includeUnknownSeriesItems: true,
        },
      });
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
      opts: PageOptions & { eventType?: number; includeSeries?: boolean } = {},
    ): Promise<SonarrPage<SonarrHistoryRecord>> {
      const { page = 1, pageSize = 50, sortKey = "date", sortDirection = "descending", includeSeries = true } = opts;
      return http.get<SonarrPage<SonarrHistoryRecord>>("/history", {
        params: {
          page,
          pageSize,
          sortKey,
          sortDirection,
          includeSeries,
          includeEpisode: true,
          eventType: opts.eventType,
        },
      });
    },

    /**
     * Every history record since a timestamp.
     *
     * The incremental sync's whole basis. Unpaged by design on Sonarr's side,
     * so the caller keeps the watermark tight — a first run with a zero
     * watermark would ask for the entire history of the instance.
     */
    async historySince(since: Date, opts: { eventType?: number } = {}): Promise<SonarrHistoryRecord[]> {
      return (
        (await http.get<SonarrHistoryRecord[]>("/history/since", {
          params: { date: since.toISOString(), includeSeries: false, eventType: opts.eventType },
          timeoutMs: 60_000,
        })) ?? []
      );
    },

    async historyForSeries(seriesId: number): Promise<SonarrHistoryRecord[]> {
      return (
        (await http.get<SonarrHistoryRecord[]>("/history/series", { params: { seriesId, includeSeries: false } })) ?? []
      );
    },

    /** Mark a grab as failed, which un-blocks Sonarr to look for another. */
    markHistoryFailed(historyId: number): Promise<void> {
      return http.post(`/history/failed/${historyId}`);
    },

    /** Interactive search. Slow, indexer-hitting, and only ever user-initiated. */
    async releases(opts: { seriesId: number; seasonNumber?: number; episodeId?: number }): Promise<SonarrRelease[]> {
      return (
        (await http.get<SonarrRelease[]>("/release", {
          params: { ...opts },
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
     * Takes the release object back verbatim — Sonarr matches on the whole
     * payload, not on the guid alone.
     */
    grabRelease(release: SonarrRelease): Promise<void> {
      return http.post("/release", release, { timeoutMs: 60_000 });
    },

    /**
     * The calendar, in **episodes**.
     *
     * Radarr's equivalent returns movies, because a movie is its own release
     * date. A series has no single air date — only its episodes do — so this
     * returns episodes with their series attached. Anything rendering both
     * calendars has to handle two different row shapes; there is no honest way
     * to make this one return series.
     */
    async calendar(start: Date, end: Date, opts: { unmonitored?: boolean } = {}): Promise<SonarrEpisode[]> {
      return (
        (await http.get<SonarrEpisode[]>("/calendar", {
          params: {
            start: start.toISOString(),
            end: end.toISOString(),
            unmonitored: opts.unmonitored ?? false,
            includeSeries: true,
            includeEpisodeFile: false,
          },
        })) ?? []
      );
    },

    /**
     * Missing episodes — again, episodes rather than series.
     *
     * "Wanted" in Sonarr means an episode that has aired, is monitored and has
     * no file. A series-level answer would be meaningless: almost every
     * continuing show is missing its next episode.
     */
    wantedMissing(opts: PageOptions = {}): Promise<SonarrPage<SonarrEpisode>> {
      const { page = 1, pageSize = 50, sortKey = "airDateUtc", sortDirection = "descending" } = opts;
      return http.get<SonarrPage<SonarrEpisode>>("/wanted/missing", {
        params: { page, pageSize, sortKey, sortDirection, monitored: true, includeSeries: true },
      });
    },

    wantedCutoff(opts: PageOptions = {}): Promise<SonarrPage<SonarrEpisode>> {
      const { page = 1, pageSize = 50, sortKey = "airDateUtc", sortDirection = "descending" } = opts;
      return http.get<SonarrPage<SonarrEpisode>>("/wanted/cutoff", {
        params: { page, pageSize, sortKey, sortDirection, monitored: true, includeSeries: true },
      });
    },

    blocklist(opts: PageOptions = {}): Promise<SonarrPage<SonarrBlocklistItem>> {
      const { page = 1, pageSize = 50, sortKey = "date", sortDirection = "descending" } = opts;
      return http.get<SonarrPage<SonarrBlocklistItem>>("/blocklist", {
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
