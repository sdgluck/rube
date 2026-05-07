export const SECTION_TYPE_MAP: Record<string, number> = { movie: 1, show: 2, artist: 8, photo: 13 };

export type PlexHealthCallback = (service: "Plex" | "Plex.tv", status: "ok" | "error", message: string) => void;

export interface PlexClientOptions {
  url: string;
  token: string;
  signal?: AbortSignal;
  onHealth?: PlexHealthCallback;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, string | number | undefined | null>;
  headers?: Record<string, string>;
}

export interface PlexSection {
  key: string;
  title: string;
  type: string;
}

export interface PlexHub {
  identifier: string;
  title: string;
  promotedToOwnHome?: number;
  promotedToRecommendedHome?: number;
  promotedToSharedHome?: number;
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
}

export interface PlexHistoryItem {
  type: string;
  ratingKey: string;
  title: string;
  year?: number;
  grandparentTitle?: string;
  grandparentRatingKey?: string;
  accountID?: number;
  viewedAt?: number;
}

export interface PlexCollection {
  ratingKey: string;
  title: string;
  addedAt?: number;
}

export interface PlexCollectionDetail {
  ratingKey: string;
  title: string;
  summary: string;
  childCount: number;
  thumb: string;
  labels: string[];
  smart: boolean;
  /** Smart-collection filter URI (`/library/sections/N/all?…`). Empty for non-smart collections. */
  content: string;
  addedAt?: number;
}

export interface PlexLabel {
  tag: string;
}

export interface PlexAccount {
  id: string;
  name?: string;
}

export interface PlexSharing {
  id: number;
  userId: number;
  username: string;
  machineIdentifier: string;
}

export interface PlexSharedServerDetail {
  userId: number;
  filterMovies: string;
  filterTelevision: string;
  librarySectionIds: number[];
}

export interface PlexHubItem {
  ratingKey: string;
  title: string;
  type: string;
  year?: number;
  thumb?: string;
  art?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  viewCount?: number;
  addedAt?: number;
  contentRating?: string;
  summary?: string;
  librarySectionID?: number;
  librarySectionTitle?: string;
  labels: string[];
}

export interface PlexHomeHub {
  hubKey: string;
  hubIdentifier: string;
  title: string;
  type: string;
  context?: string;
  items: PlexHubItem[];
}

export interface PlexSession {
  ratingKey?: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  type: string;
  year?: number;
  thumb?: string;
  parentThumb?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  user: string;
  userThumb?: string;
  player: string;
  playerMachineId?: string;
  product?: string;
  platform?: string;
  state: string;
  local?: boolean;
  relayed?: boolean;
  secure?: boolean;
  address?: string;
  location?: string;
  bandwidth?: number;
  decision: string;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  videoDecision?: string;
  audioDecision?: string;
  transcodeSpeed?: number;
  transcodeProgress?: number;
  transcodeHwEncoding?: boolean;
  sourceVideoCodec?: string;
  sourceAudioCodec?: string;
}

export interface PlexRecentItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  addedAt: number;
  grandparentTitle?: string;
  parentTitle?: string;
  container?: string;
  videoResolution?: string;
  fileSize?: number;
}

export interface PlexMediaItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  addedAt?: number;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}

export interface PlexStreamInfo {
  streamType: number; // 1=video, 2=audio, 3=subtitle
  codec?: string;
  displayTitle?: string;
  bitrate?: number;
  // Video
  width?: number;
  height?: number;
  frameRate?: number;
  profile?: string;
  level?: number;
  bitDepth?: number;
  chromaSubsampling?: string;
  colorPrimaries?: string;
  colorRange?: string;
  colorSpace?: string;
  scanType?: string;
  // Audio
  channels?: number;
  audioChannelLayout?: string;
  samplingRate?: number;
  language?: string;
  languageCode?: string;
}

export interface PlexPartInfo {
  file?: string;
  size?: number;
  container?: string;
  duration?: number;
  streams: PlexStreamInfo[];
}

export interface PlexMediaInfo {
  videoResolution?: string;
  videoCodec?: string;
  videoFrameRate?: string;
  videoProfile?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  optimizedForStreaming?: boolean;
  parts: PlexPartInfo[];
}

export interface PlexMediaDetail extends PlexMediaItem {
  summary: string;
  contentRating?: string;
  duration?: number;
  originallyAvailableAt?: string;
  studio?: string;
  rating?: number;
  audienceRating?: number;
  viewOffset?: number;
  viewCount?: number;
  genres: string[];
  directors: string[];
  collections: Array<{ id?: number; tag: string }>;
  media: PlexMediaInfo[];
}

export interface PlexDirectoryEntry {
  tag: string;
  count: number;
  key: string;
}

export interface PlexMediaFullDetail {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  contentRating?: string;
  rating?: number;
  audienceRating?: number;
  duration?: number;
  studio?: string;
  editionTitle?: string;
  /** TV show airing status (Plex `status`): typically "Continuing" or "Ended". */
  status?: string;
  guids: string[];
  media: Array<{
    videoResolution?: string;
    videoCodec?: string;
    audioCodec?: string;
    audioChannels?: number;
    bitrate?: number;
    width?: number;
    height?: number;
    bitDepth?: number;
    colorSpace?: string;
    videoDisplayTitle?: string;
  }>;
}

export interface PlexPoster {
  key: string;
  selected: boolean;
  ratingKey: string;
}

export interface PlexChildItem {
  ratingKey: string;
  type: string;
  title: string;
  index?: number;
  thumb?: string;
  leafCount?: number;
  year?: number;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}

export interface MediaFilters {
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}

export interface PinOptions {
  promotedToOwnHome?: number;
  promotedToRecommendedHome?: number;
  promotedToSharedHome?: number;
}

export interface WatchHistoryOptions {
  accountID?: string;
  librarySectionID?: string;
  limit?: number;
}
