/**
 * The series library, and the episode tree beneath it.
 */

import type { ServarrHttp } from "@tinkerbell/servarr-http";
import { parseExternalId } from "@tinkerbell/servarr-http";
import type { SonarrEpisode, SonarrEpisodeFile, SonarrRaw, SonarrSeries } from "./types.ts";

/** As in Radarr: `GET /series` is the whole library in one response. */
const FULL_LIBRARY_TIMEOUT_MS = 120_000;

export function toSeries(row: SonarrRaw): SonarrSeries {
  return {
    ...(row as unknown as SonarrSeries),
    id: row.id as number,
    title: (row.title as string) ?? "",
    monitored: row.monitored === true,
    raw: row,
  };
}

/**
 * Does this series have anything on disk?
 *
 * Sonarr has no `hasFile`. A series counts as present if any episode is, which
 * `statistics.episodeFileCount` reports — the direct analogue of Radarr's
 * boolean, and the one piece of Radarr/Sonarr parity worth naming explicitly
 * because getting it wrong makes every "missing" query wrong.
 */
export function hasFile(series: SonarrSeries): boolean {
  return (series.statistics?.episodeFileCount ?? 0) > 0;
}

/** How Sonarr should monitor a series when it is added. */
export type SeriesMonitorMode =
  | "all"
  | "future"
  | "missing"
  | "existing"
  | "firstSeason"
  | "lastSeason"
  | "latestSeason"
  | "pilot"
  | "none";

export interface AddSeriesOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  monitor: boolean;
  searchOnAdd: boolean;
  /** Defaults to "all". Radarr has no equivalent — see the type above. */
  monitorMode?: SeriesMonitorMode;
  seriesType?: string;
  seasonFolder?: boolean;
  tags?: number[];
}

export interface AddSeriesResult {
  status: "added" | "exists" | "failed";
  id?: number;
  title?: string;
  error?: string;
}

export interface DeleteSeriesOptions {
  deleteFiles: boolean;
  addImportExclusion: boolean;
}

export interface SeriesEditorOptions {
  seriesIds: number[];
  monitored?: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  seriesType?: string;
  seasonFolder?: boolean;
  tags?: number[];
  applyTags?: "add" | "remove" | "replace";
  moveFiles?: boolean;
}

export function createLibrary(http: ServarrHttp) {
  async function allSeries(): Promise<SonarrSeries[]> {
    const rows = await http.get<SonarrRaw[]>("/series", { timeoutMs: FULL_LIBRARY_TIMEOUT_MS });
    return (rows ?? []).map(toSeries);
  }

  async function series(id: number): Promise<SonarrSeries | null> {
    const row = await http.get<SonarrRaw | null>(`/series/${id}`);
    return row ? toSeries(row) : null;
  }

  /**
   * Find a series already in the library by external id.
   *
   * Unlike Radarr, **there is no server-side filter** — no `GET /series?tvdbId=`
   * — so every scheme walks the whole list. That is the single request the
   * whole-library timeout above exists for, and the reason the mirror carries
   * `tvdb_id` as an indexed column: asking this question repeatedly against a
   * live Sonarr does not scale, and against SQLite it is free.
   */
  async function findByExternalId(externalId: string): Promise<SonarrSeries | null> {
    const parsed = parseExternalId(externalId);
    if (!parsed) return null;

    const all = await http.get<SonarrRaw[]>("/series", { timeoutMs: FULL_LIBRARY_TIMEOUT_MS });
    const hit = all?.find((s) => {
      if (parsed.scheme === "tvdb") return String(s.tvdbId) === parsed.value;
      if (parsed.scheme === "imdb") return s.imdbId === parsed.value;
      return String(s.tmdbId) === parsed.value;
    });
    return hit ? toSeries(hit) : null;
  }

  async function lookup(term: string): Promise<SonarrSeries[]> {
    const rows = await http.get<SonarrRaw[]>("/series/lookup", { params: { term }, timeoutMs: 30_000 });
    return (rows ?? []).map(toSeries);
  }

  async function addSeries(candidate: SonarrSeries, opts: AddSeriesOptions): Promise<AddSeriesResult> {
    const body = {
      ...candidate.raw,
      qualityProfileId: opts.qualityProfileId,
      rootFolderPath: opts.rootFolderPath,
      monitored: opts.monitor,
      seasonFolder: opts.seasonFolder ?? true,
      ...(opts.seriesType ? { seriesType: opts.seriesType } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
      addOptions: {
        monitor: opts.monitorMode ?? "all",
        searchForMissingEpisodes: opts.searchOnAdd,
        searchForCutoffUnmetEpisodes: false,
      },
    };

    const res = await http.raw("POST", "/series", body, { timeoutMs: 30_000 });
    if (res.ok) {
      const data = res.body ? (JSON.parse(res.body) as { id?: number; title?: string }) : {};
      return { status: "added", id: data.id, title: data.title };
    }
    if (res.status === 400 && /already.*been added|already exists/i.test(res.body)) {
      return { status: "exists", title: candidate.title };
    }
    return { status: "failed", error: `${res.status}${res.body ? `: ${res.body.slice(0, 200)}` : ""}` };
  }

  /**
   * Change a series, safely.
   *
   * Mutator-only and re-reads first, for the same reason as Radarr's — and the
   * stakes are higher here. Sonarr v3 carries `languageProfileId`, which v4
   * removed and which this client does not model; a PUT built from anything
   * other than a freshly-read record drops it and silently resets the series to
   * the default language profile. That is invisible until something downloads
   * in the wrong language weeks later.
   */
  async function updateSeries(
    id: number,
    mutate: (current: SonarrSeries) => SonarrRaw,
    opts: { moveFiles?: boolean } = {},
  ): Promise<SonarrSeries> {
    const current = await series(id);
    if (!current) throw new Error(`Sonarr: series ${id} not found`);
    const body = mutate(current);
    const updated = await http.put<SonarrRaw>(`/series/${id}`, body, {
      params: { moveFiles: opts.moveFiles ?? false },
      timeoutMs: 30_000,
    });
    return updated ? toSeries(updated) : current;
  }

  function setMonitored(id: number, monitored: boolean): Promise<SonarrSeries> {
    return updateSeries(id, (current) => ({ ...current.raw, monitored }));
  }

  /**
   * Monitor or unmonitor one season.
   *
   * A season has no id and no endpoint of its own, so this is a whole-series
   * PUT with one array element flipped — which makes it exactly the operation
   * the mutator signature was designed to make safe.
   */
  function setSeasonMonitored(id: number, seasonNumber: number, monitored: boolean): Promise<SonarrSeries> {
    return updateSeries(id, (current) => {
      const seasons = (current.raw.seasons as Array<Record<string, unknown>> | undefined) ?? [];
      return {
        ...current.raw,
        seasons: seasons.map((s) => (s.seasonNumber === seasonNumber ? { ...s, monitored } : s)),
      };
    });
  }

  async function editor(opts: SeriesEditorOptions): Promise<SonarrSeries[]> {
    const rows = await http.put<SonarrRaw[]>("/series/editor", opts, { timeoutMs: 60_000 });
    return (rows ?? []).map(toSeries);
  }

  async function deleteSeries(id: number, opts: DeleteSeriesOptions): Promise<void> {
    await http.del(`/series/${id}`, {
      params: {
        deleteFiles: opts.deleteFiles,
        addImportListExclusion: opts.addImportExclusion,
      },
    });
  }

  async function deleteSeriesBulk(seriesIds: number[], opts: DeleteSeriesOptions): Promise<void> {
    await http.del("/series/editor", {
      body: {
        seriesIds,
        deleteFiles: opts.deleteFiles,
        addImportListExclusion: opts.addImportExclusion,
      },
      timeoutMs: 60_000,
    });
  }

  // ── Episodes ───────────────────────────────────────────────────────────
  //
  // Never mirrored: five hundred shows is fifty thousand episodes, and nothing
  // in the unified pages asks a question at this granularity. Series detail
  // proxies them live, which is one request for one show the user is looking at.

  async function episodes(seriesId: number, opts: { seasonNumber?: number } = {}): Promise<SonarrEpisode[]> {
    return (
      (await http.get<SonarrEpisode[]>("/episode", {
        params: { seriesId, seasonNumber: opts.seasonNumber, includeEpisodeFile: true },
        timeoutMs: 30_000,
      })) ?? []
    );
  }

  function episode(id: number): Promise<SonarrEpisode> {
    return http.get<SonarrEpisode>(`/episode/${id}`);
  }

  /**
   * Monitor or unmonitor individual episodes.
   *
   * The one place Sonarr offers a genuine partial update, and it should always
   * be preferred over a series PUT when episodes are what changed.
   */
  function setEpisodesMonitored(episodeIds: number[], monitored: boolean): Promise<void> {
    return http.put("/episode/monitor", { episodeIds, monitored });
  }

  async function episodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
    return (await http.get<SonarrEpisodeFile[]>("/episodefile", { params: { seriesId } })) ?? [];
  }

  async function deleteEpisodeFile(fileId: number): Promise<void> {
    await http.del(`/episodefile/${fileId}`);
  }

  async function deleteEpisodeFiles(fileIds: number[]): Promise<void> {
    await http.del("/episodefile/bulk", { body: { episodeFileIds: fileIds } });
  }

  return {
    allSeries,
    series,
    findByExternalId,
    lookup,
    addSeries,
    updateSeries,
    setMonitored,
    setSeasonMonitored,
    editor,
    deleteSeries,
    deleteSeriesBulk,
    episodes,
    episode,
    setEpisodesMonitored,
    episodeFiles,
    deleteEpisodeFile,
    deleteEpisodeFiles,
  };
}
