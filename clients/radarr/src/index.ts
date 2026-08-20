/**
 * The Radarr client.
 *
 * Composed from per-concern modules the way `clients/plex` is, and built per
 * instance rather than per process — a split 1080p/4K setup is two Radarrs
 * with different keys, and there is no state worth sharing between them.
 *
 * A factory rather than free functions taking a config, which is what this
 * replaced, for one concrete reason: `signal` and `onHealth` have nowhere to
 * live in the free-function shape. Without them a whole-library sync inside a
 * cancellable job could not be cancelled, and nothing reported whether the
 * instance was reachable.
 */

import { createServarrHttp, createCommands, type ServarrHttpOptions } from "@tinkerbell/servarr-http";
import { createLibrary } from "./library.ts";
import { createActivity } from "./activity.ts";
import { createSystem } from "./system.ts";
import { createSettings } from "./settings.ts";

export interface RadarrClientOptions {
  url: string;
  apiKey: string;
  signal?: AbortSignal;
  onHealth?: ServarrHttpOptions["onHealth"];
}

/**
 * Radarr's command names.
 *
 * Listed rather than passed as free strings so a typo is a build error. A
 * mistyped command name is accepted by the API with a 201 and then does
 * nothing at all, which is the worst way for this to fail.
 */
export const RADARR_COMMANDS = {
  refreshMovie: "RefreshMovie",
  moviesSearch: "MoviesSearch",
  rescanMovie: "RescanMovie",
  missingMoviesSearch: "MissingMoviesSearch",
  cutoffUnmetMoviesSearch: "CutoffUnmetMoviesSearch",
  renameMovie: "RenameMovie",
  renameFiles: "RenameFiles",
  downloadedMoviesScan: "DownloadedMoviesScan",
  rssSync: "RssSync",
  refreshMonitoredDownloads: "RefreshMonitoredDownloads",
  importListSync: "ImportListSync",
  manualImport: "ManualImport",
  backup: "Backup",
} as const;

export function createRadarrClient(opts: RadarrClientOptions) {
  const http = createServarrHttp({
    baseUrl: opts.url,
    apiKey: opts.apiKey,
    apiVersion: "v3",
    signal: opts.signal,
    onHealth: opts.onHealth,
  });

  return {
    ...createLibrary(http),
    ...createActivity(http),
    system: createSystem(http),
    settings: createSettings(http),
    commands: createCommands(http),

    /** Search for a movie now. The most-used command, so it gets a verb. */
    search(movieIds: number[]) {
      return createCommands(http).run(RADARR_COMMANDS.moviesSearch, { movieIds });
    },

    /** Re-read metadata and rescan the folder for one movie. */
    refresh(movieId: number) {
      return createCommands(http).run(RADARR_COMMANDS.refreshMovie, { movieIds: [movieId] });
    },
  };
}

export type RadarrClient = ReturnType<typeof createRadarrClient>;

export * from "./types.ts";
export { RADARR_SETTINGS_AREAS, RADARR_AREA_ENDPOINTS, type RadarrSettingsArea } from "./settings.ts";
export { capabilitiesFor, parseMajor, RADARR_CAPABILITIES, type RadarrCapability } from "./capabilities.ts";
export { toMovie } from "./library.ts";
export type { AddMovieOptions, AddMovieResult, DeleteMovieOptions, MovieEditorOptions } from "./library.ts";
export type { PageOptions, RemoveFromQueueOptions } from "./activity.ts";
