export const SECTION_TYPE_MAP: Record<string, number> = { movie: 1, show: 2, artist: 8, photo: 13 };

/** Plex `type` enum for a collection — used by /library/sections/:id/all filtering and label PUTs. */
export const PLEX_COLLECTION_TYPE = 18;

/**
 * Plex `type` enum for an episode.
 *
 * Passed to a *section* listing to walk a TV library at episode level, which is
 * where the files live — a show row carries none.
 */
export const PLEX_EPISODE_TYPE = 4;
/** Plex's numeric type for a show, for asking a TV section for its top-level rows explicitly. */
export const PLEX_SHOW_TYPE = 2;

export type PlexHealthCallback = (service: "Plex" | "Plex.tv", status: "ok" | "error", message: string) => void;

export interface PlexClientOptions {
  url: string;
  token: string;
  signal?: AbortSignal;
  onHealth?: PlexHealthCallback;
  /**
   * The account service. Only ever overridden by tests — there is exactly one
   * plex.tv in production — but without the seam none of the sharing or user
   * management calls can be exercised by the mock-server pattern the rest of
   * this client is tested with.
   */
  plexTvUrl?: string;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, string | number | undefined | null>;
  headers?: Record<string, string>;
}

export interface PlexTvRequestOptions extends RequestOptions {
  /** A string is sent verbatim as XML; anything else is JSON-encoded. */
  body?: string | Record<string, unknown>;
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
  promotedToRecommended?: number;
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
  /** Unix *seconds*, unlike everything else in this codebase. */
  viewedAt?: number;
  librarySectionID?: string;
}

export interface PlexCollection {
  ratingKey: string;
  title: string;
  addedAt?: number;
  /**
   * Labels as carried by the section listing, when it carries them at all.
   * `undefined` means "the listing didn't say" — which for a collection with
   * no labels is indistinguishable from "none", so callers that need a
   * definitive answer must fall back to `getCollectionLabels`.
   */
  labels?: string[];
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
  /** How the collection's items appear in the library. `-1` is "use the library default". */
  collectionMode: CollectionMode;
  /** The order Plex serves the collection's children in. */
  collectionSort: CollectionSort;
}

/**
 * Plex's `collectionMode` pref, verbatim. `-1` is not "unset" — it is the
 * library's own default, which is a distinct third state from "hide" and
 * "show", so it round-trips rather than being normalised away.
 */
export const COLLECTION_MODES = [-1, 0, 1, 2] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

/** Plex's `collectionSort` pref: release date, alphabetical, or hand-ordered. */
export const COLLECTION_SORTS = [0, 1, 2] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export interface CollectionPrefs {
  collectionMode?: CollectionMode;
  collectionSort?: CollectionSort;
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
  /**
   * The server token this share's apps sign in with. Read-only use only: it is
   * how the preview asks Plex for the user's actual home screen instead of
   * reconstructing it from the owner's.
   */
  accessToken?: string;
}

/**
 * The four booleans plex.tv calls "sharing settings". Optional throughout:
 * a `PUT` that omits one leaves it alone, which is what every partial edit
 * in the UI wants.
 */
export interface PlexShareSettings {
  /** Downloads / sync. */
  allowSync?: boolean;
  /** Live TV & DVR. */
  allowTuners?: boolean;
  allowChannels?: boolean;
  allowCameraUpload?: boolean;
}

/** Raw plex.tv filter strings, e.g. `contentRating=PG-13|label=Rube`. */
export interface PlexShareFilters {
  filterMovies?: string;
  filterTelevision?: string;
  filterMusic?: string;
}

/**
 * One row of `/api/servers/{machineId}/shared_servers` — the authoritative
 * view of what a user can actually see, including the share id the section
 * and unshare endpoints are keyed by (which is *not* the user id).
 */
export interface PlexSharedServerFull extends Required<PlexShareSettings>, Required<PlexShareFilters> {
  /** The shared-server id. `PUT`/`DELETE .../shared_servers/{id}` want this. */
  sharedServerId: number;
  userId: number;
  username: string;
  email: string;
  /** False while the invite is still outstanding. */
  accepted: boolean;
  librarySectionIds: number[];
}

/** A user on the account, from `/api/users/` (friends) or `/api/v2/home/users`. */
export interface PlexUserRecord {
  id: number;
  username: string;
  title: string;
  email: string;
  thumb: string;
  /** In the owner's Plex Home. */
  home: boolean;
  /** A managed (profile-restricted) user rather than a full Plex account. */
  restricted: boolean;
  /** PIN-protected. The PIN itself is write-only and can never be read back. */
  protected: boolean;
}

export interface PlexInvite {
  id: number;
  /** `sent` is an invite we issued; `received` is one waiting on us. */
  direction: "sent" | "received";
  username: string;
  email: string;
  thumb: string;
  createdAt?: number;
}

export interface InviteUserOptions {
  machineIdentifier: string;
  /** One of the two. An email invites someone not yet on the account. */
  invitedEmail?: string;
  invitedId?: number;
  /** Empty shares every library. */
  librarySectionIds: number[];
  settings?: PlexShareSettings;
  filters?: PlexShareFilters;
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
  /** Plex's live-session identifier. Reused across unrelated plays over time. */
  sessionKey?: string;
  /**
   * `Session.id` — the opaque handle `/status/sessions/terminate` wants. A
   * different value from `sessionKey`, and passing that one instead silently
   * fails to kill anything.
   */
  sessionId?: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  librarySectionId?: string;
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
  /** Plex account id. Matches `plex_users.userId`; absent when Plex omits `User`. */
  userId?: number;
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
  /** Streamable URL for the part. `file` is the server-side path, not this. */
  key?: string;
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
  /** Agent ids, `imdb://tt0111161` style. Empty when Plex matched nothing. */
  guids: string[];
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

/** One row of `/:/prefs`. Plex types values loosely, hence the union. */
export interface PlexPref {
  id: string;
  label?: string;
  summary?: string;
  type?: string;
  value?: string | number | boolean;
  default?: string | number | boolean;
  hidden?: boolean;
  advanced?: boolean;
  group?: string;
  enumValues?: string;
}

export interface PinOptions {
  promotedToOwnHome?: number;
  promotedToRecommended?: number;
  promotedToSharedHome?: number;
}

export interface WatchHistoryOptions {
  accountID?: string;
  librarySectionID?: string;
  limit?: number;
  /** `X-Plex-Container-Start`, for walking the full history rather than the head of it. */
  offset?: number;
  /** Only entries at or after this Unix *second* — Plex's `viewedAt` unit, not ms. */
  viewedAfter?: number;
}
