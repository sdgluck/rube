/**
 * Radarr's wire types, narrowed to what Rube reads.
 *
 * Deliberately not exhaustive and deliberately not shared with Sonarr. The two
 * apps look similar enough at this level to tempt a common `MediaItem`
 * supertype, and every attempt at one founders on the same rock: a movie is a
 * single record with a single file, a series is a tree of seasons and episodes
 * with counts instead of a file. Keeping the types apart keeps the divergence
 * visible instead of hidden behind optional properties.
 */

/** `[Radarr] index signature escape hatch` — see `RadarrMovie.raw` below. */
export type RadarrRaw = Record<string, unknown>;

export interface RadarrQuality {
  quality?: { id?: number; name?: string; resolution?: number };
  revision?: { version?: number; real?: number };
}

export interface RadarrMovieFile {
  id: number;
  movieId: number;
  relativePath?: string;
  path?: string;
  size?: number;
  dateAdded?: string;
  quality?: RadarrQuality;
  customFormatScore?: number;
  languages?: Array<{ id: number; name: string }>;
  mediaInfo?: {
    videoCodec?: string;
    audioCodec?: string;
    audioChannels?: number;
    resolution?: string;
    videoBitrate?: number;
    runTime?: string;
  };
}

export interface RadarrImage {
  coverType?: string;
  url?: string;
  remoteUrl?: string;
}

/**
 * A movie as Radarr stores it.
 *
 * `raw` carries the untouched payload alongside the parsed view. It exists for
 * exactly one reason: Radarr's PUT replaces the record wholesale and nulls
 * anything the body omits, so an update has to send back every field — including
 * the ones this interface does not model. See `library.updateMovie`.
 */
export interface RadarrMovie {
  id: number;
  title: string;
  sortTitle?: string;
  originalTitle?: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  titleSlug?: string;
  monitored: boolean;
  hasFile: boolean;
  /** tba | announced | inCinemas | released | deleted */
  status?: string;
  minimumAvailability?: string;
  qualityProfileId?: number;
  rootFolderPath?: string;
  path?: string;
  folderName?: string;
  sizeOnDisk?: number;
  runtime?: number;
  certification?: string;
  studio?: string;
  overview?: string;
  genres?: string[];
  tags?: number[];
  added?: string;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  images?: RadarrImage[];
  movieFile?: RadarrMovieFile;
  collection?: { title?: string; tmdbId?: number };
  ratings?: Record<string, { value?: number; votes?: number }>;
  /** Populated only by `lookup` — a poster for something not yet added. */
  remotePoster?: string;
  raw: RadarrRaw;
}

export interface RadarrQueueItem {
  id: number;
  movieId?: number;
  title?: string;
  status?: string;
  /** downloading | importPending | importBlocked | failedPending | … */
  trackedDownloadState?: string;
  /** ok | warning | error */
  trackedDownloadStatus?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  downloadId?: string;
  downloadClient?: string;
  indexer?: string;
  protocol?: string;
  errorMessage?: string;
  quality?: RadarrQuality;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
  movie?: RadarrMovie;
}

export interface RadarrHistoryRecord {
  id: number;
  movieId?: number;
  /** grabbed | downloadFolderImported | downloadFailed | movieFileDeleted | movieFileRenamed | ignored */
  eventType: string;
  sourceTitle?: string;
  date: string;
  downloadId?: string;
  quality?: RadarrQuality;
  data?: Record<string, string>;
  movie?: RadarrMovie;
}

export interface RadarrRelease {
  guid: string;
  title: string;
  indexer?: string;
  indexerId?: number;
  size?: number;
  seeders?: number;
  leechers?: number;
  age?: number;
  ageHours?: number;
  protocol?: string;
  quality?: RadarrQuality;
  customFormatScore?: number;
  customFormats?: Array<{ id: number; name: string }>;
  /** True when Radarr would refuse this release; `rejections` says why. */
  rejected?: boolean;
  rejections?: string[];
  downloadUrl?: string;
  infoUrl?: string;
  releaseWeight?: number;
}

/** One quality as the profile and definition endpoints spell it. */
export interface RadarrQuality {
  id: number;
  name: string;
  source?: string;
  resolution?: number;
  modifier?: string;
}

/**
 * One row of a profile's `items`: either a single quality or a named group of
 * them. Groups carry an `id` (1000 and up) and no `quality`; singles carry a
 * `quality` and an empty `items`. Order is lowest preference first.
 */
export interface RadarrQualityProfileItem {
  id?: number;
  name?: string;
  quality?: RadarrQuality;
  items: RadarrQualityProfileItem[];
  allowed: boolean;
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  /** A quality id, or a group id when the cutoff is a group. */
  cutoff?: number;
  minFormatScore?: number;
  cutoffFormatScore?: number;
  minUpgradeFormatScore?: number;
  items?: RadarrQualityProfileItem[];
  formatItems?: Array<{ format: number; name?: string; score: number }>;
  /** Anything else the record carries (`language`, …). Kept, because a PUT replaces wholesale. */
  [extra: string]: unknown;
}

/** Size bounds per quality, in MB per minute of runtime. A `null` max is unlimited. */
export interface RadarrQualityDefinition {
  id: number;
  quality: RadarrQuality;
  title: string;
  weight?: number;
  minSize: number | null;
  maxSize: number | null;
  preferredSize: number | null;
}

export interface RadarrCustomFormatSpecification {
  id?: number;
  name: string;
  /** ReleaseTitleSpecification, SourceSpecification, QualityModifierSpecification, SizeSpecification, … */
  implementation: string;
  implementationName?: string;
  negate: boolean;
  required: boolean;
  fields: Array<{ name: string; value?: unknown; [extra: string]: unknown }>;
}

export interface RadarrCustomFormat {
  id?: number;
  name: string;
  includeCustomFormatWhenRenaming?: boolean;
  specifications: RadarrCustomFormatSpecification[];
}

export interface RadarrRootFolder {
  id: number;
  path: string;
  accessible?: boolean;
  freeSpace?: number;
  totalSpace?: number;
  unmappedFolders?: Array<{ name: string; path: string }>;
}

export interface RadarrTag {
  id: number;
  label: string;
}

export interface RadarrSystemStatus {
  appName?: string;
  instanceName?: string;
  version?: string;
  branch?: string;
  osName?: string;
}

export interface RadarrDiskSpace {
  path: string;
  label?: string;
  freeSpace: number;
  totalSpace: number;
}

/** The *Arr's own health warnings — distinct from Rube's health checks. */
export interface RadarrHealthItem {
  source?: string;
  /** ok | notice | warning | error */
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface RadarrPage<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface RadarrBlocklistItem {
  id: number;
  movieId?: number;
  sourceTitle?: string;
  date?: string;
  protocol?: string;
  indexer?: string;
  message?: string;
  quality?: RadarrQuality;
  movie?: RadarrMovie;
}

/** One file `GET /manualimport` offers, with Radarr's verdict on it. */
export interface RadarrManualImportItem {
  id?: number;
  path: string;
  name?: string;
  size?: number;
  movie?: { id: number; title?: string };
  quality?: RadarrQuality;
  languages?: Array<{ id: number; name: string }>;
  releaseGroup?: string;
  downloadId?: string;
  indexerFlags?: number;
  /** Radarr's objections, e.g. "Not an upgrade for existing movie file". ManualImport imports regardless. */
  rejections?: Array<{ reason: string; type?: string }>;
}

/** One file in a `ManualImport` command. */
export interface RadarrManualImportFile {
  path: string;
  movieId: number;
  quality?: RadarrQuality;
  languages?: Array<{ id: number; name: string }>;
  releaseGroup?: string;
  downloadId?: string;
  indexerFlags?: number;
}
