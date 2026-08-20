/**
 * Sonarr's wire types.
 *
 * The shape of this file is the argument against a shared *Arr abstraction. A
 * Radarr movie is one record with one file; a Sonarr series is a tree — series
 * holds seasons, seasons hold episodes, episodes hold files — and presence is a
 * pair of counts rather than a boolean. Nothing below has a meaningful common
 * supertype with `clients/radarr`, and pretending otherwise would push the
 * difference into optional properties that every caller then has to re-derive.
 */

export type SonarrRaw = Record<string, unknown>;

export interface SonarrQuality {
  quality?: { id?: number; name?: string; resolution?: number };
  revision?: { version?: number; real?: number };
}

export interface SonarrImage {
  coverType?: string;
  url?: string;
  remoteUrl?: string;
}

/**
 * One season of a series.
 *
 * **A season has no id.** It is identified by `seasonNumber` within its series,
 * which is why seasons are denormalised onto the series row in the mirror
 * rather than given a table of their own, and why monitoring a season is a PUT
 * of the whole series rather than a PUT of the season.
 */
export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    episodeCount?: number;
    episodeFileCount?: number;
    totalEpisodeCount?: number;
    sizeOnDisk?: number;
    percentOfEpisodes?: number;
  };
}

export interface SonarrSeriesStatistics {
  seasonCount?: number;
  episodeCount?: number;
  episodeFileCount?: number;
  totalEpisodeCount?: number;
  sizeOnDisk?: number;
  percentOfEpisodes?: number;
}

export interface SonarrSeries {
  id: number;
  title: string;
  sortTitle?: string;
  year?: number;
  tvdbId?: number;
  imdbId?: string;
  tmdbId?: number;
  titleSlug?: string;
  monitored: boolean;
  /** continuing | ended | upcoming | deleted */
  status?: string;
  /** standard | daily | anime — changes how episodes are numbered and matched. */
  seriesType?: string;
  network?: string;
  airTime?: string;
  ended?: boolean;
  seasonFolder?: boolean;
  useSceneNumbering?: boolean;
  qualityProfileId?: number;
  /** Sonarr v3 only; removed in v4. See the clobbering note in `library.ts`. */
  languageProfileId?: number;
  rootFolderPath?: string;
  path?: string;
  runtime?: number;
  certification?: string;
  overview?: string;
  genres?: string[];
  tags?: number[];
  added?: string;
  nextAiring?: string;
  previousAiring?: string;
  seasons?: SonarrSeason[];
  statistics?: SonarrSeriesStatistics;
  images?: SonarrImage[];
  /** Populated only by `lookup`. */
  remotePoster?: string;
  raw: SonarrRaw;
}

export interface SonarrEpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber?: number;
  relativePath?: string;
  path?: string;
  size?: number;
  dateAdded?: string;
  quality?: SonarrQuality;
  customFormatScore?: number;
  mediaInfo?: {
    videoCodec?: string;
    audioCodec?: string;
    audioChannels?: number;
    resolution?: string;
  };
}

export interface SonarrEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  airDate?: string;
  airDateUtc?: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  episodeFileId?: number;
  episodeFile?: SonarrEpisodeFile;
  absoluteEpisodeNumber?: number;
  finaleType?: string;
}

export interface SonarrQueueItem {
  id: number;
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  title?: string;
  status?: string;
  trackedDownloadState?: string;
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
  quality?: SonarrQuality;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
  series?: SonarrSeries;
  episode?: SonarrEpisode;
}

export interface SonarrHistoryRecord {
  id: number;
  seriesId?: number;
  episodeId?: number;
  /** grabbed | downloadFolderImported | downloadFailed | episodeFileDeleted | … */
  eventType: string;
  sourceTitle?: string;
  date: string;
  downloadId?: string;
  quality?: SonarrQuality;
  data?: Record<string, string>;
  series?: SonarrSeries;
  episode?: SonarrEpisode;
}

export interface SonarrRelease {
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
  quality?: SonarrQuality;
  customFormatScore?: number;
  rejected?: boolean;
  rejections?: string[];
  downloadUrl?: string;
  infoUrl?: string;
  fullSeason?: boolean;
  seasonNumber?: number;
  episodeNumbers?: number[];
}

export interface SonarrBlocklistItem {
  id: number;
  seriesId?: number;
  episodeIds?: number[];
  sourceTitle?: string;
  date?: string;
  protocol?: string;
  indexer?: string;
  message?: string;
  quality?: SonarrQuality;
  series?: SonarrSeries;
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff?: number;
  minFormatScore?: number;
  cutoffFormatScore?: number;
  items?: unknown[];
  formatItems?: Array<{ format: number; name?: string; score: number }>;
}

export interface SonarrRootFolder {
  id: number;
  path: string;
  accessible?: boolean;
  freeSpace?: number;
  totalSpace?: number;
}

export interface SonarrTag {
  id: number;
  label: string;
}

export interface SonarrSystemStatus {
  appName?: string;
  instanceName?: string;
  version?: string;
  branch?: string;
}

export interface SonarrDiskSpace {
  path: string;
  label?: string;
  freeSpace: number;
  totalSpace: number;
}

export interface SonarrHealthItem {
  source?: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface SonarrPage<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}
