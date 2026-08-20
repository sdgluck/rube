/**
 * The Sonarr client.
 *
 * Structurally parallel to `clients/radarr` and deliberately not sharing code
 * with it beyond `@tinkerbell/servarr-http`. The two apps agree on transport
 * and disagree on nearly everything else — entity depth, monitoring, the
 * quality vocabulary, what the calendar returns — and every one of those
 * disagreements is easier to read here than it would be behind a shared
 * abstraction's `if (service === "sonarr")`.
 */

import { createServarrHttp, createCommands, type ServarrHttpOptions } from "@tinkerbell/servarr-http";
import { createLibrary } from "./library.ts";
import { createActivity } from "./activity.ts";
import { createSystem } from "./system.ts";
import { createSettings } from "./settings.ts";

export interface SonarrClientOptions {
  url: string;
  apiKey: string;
  signal?: AbortSignal;
  onHealth?: ServarrHttpOptions["onHealth"];
}

/**
 * Sonarr's command names.
 *
 * Note the three search granularities where Radarr has one. That difference is
 * user-visible — a series page has to offer "search this season" — so it is
 * not something the client can paper over.
 */
export const SONARR_COMMANDS = {
  refreshSeries: "RefreshSeries",
  seriesSearch: "SeriesSearch",
  seasonSearch: "SeasonSearch",
  episodeSearch: "EpisodeSearch",
  missingEpisodeSearch: "MissingEpisodeSearch",
  cutoffUnmetEpisodeSearch: "CutoffUnmetEpisodeSearch",
  rescanSeries: "RescanSeries",
  renameSeries: "RenameSeries",
  renameFiles: "RenameFiles",
  downloadedEpisodesScan: "DownloadedEpisodesScan",
  rssSync: "RssSync",
  refreshMonitoredDownloads: "RefreshMonitoredDownloads",
  importListSync: "ImportListSync",
  backup: "Backup",
} as const;

export function createSonarrClient(opts: SonarrClientOptions) {
  const http = createServarrHttp({
    baseUrl: opts.url,
    apiKey: opts.apiKey,
    apiVersion: "v3",
    signal: opts.signal,
    onHealth: opts.onHealth,
  });
  const commands = createCommands(http);

  return {
    ...createLibrary(http),
    ...createActivity(http),
    system: createSystem(http),
    settings: createSettings(http),
    commands,

    /** Search a whole series. */
    searchSeries(seriesId: number) {
      return commands.run(SONARR_COMMANDS.seriesSearch, { seriesId });
    },

    /** Search one season — no Radarr equivalent. */
    searchSeason(seriesId: number, seasonNumber: number) {
      return commands.run(SONARR_COMMANDS.seasonSearch, { seriesId, seasonNumber });
    },

    /** Search individual episodes — no Radarr equivalent. */
    searchEpisodes(episodeIds: number[]) {
      return commands.run(SONARR_COMMANDS.episodeSearch, { episodeIds });
    },

    refresh(seriesId: number) {
      return commands.run(SONARR_COMMANDS.refreshSeries, { seriesId });
    },
  };
}

export type SonarrClient = ReturnType<typeof createSonarrClient>;

export * from "./types.ts";
export { SONARR_SETTINGS_AREAS, SONARR_AREA_ENDPOINTS, type SonarrSettingsArea } from "./settings.ts";
export { capabilitiesFor, parseMajor, SONARR_CAPABILITIES, type SonarrCapability } from "./capabilities.ts";
export { toSeries, hasFile } from "./library.ts";
export type {
  AddSeriesOptions,
  AddSeriesResult,
  DeleteSeriesOptions,
  SeriesEditorOptions,
  SeriesMonitorMode,
} from "./library.ts";
export type { PageOptions, RemoveFromQueueOptions } from "./activity.ts";
