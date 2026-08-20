/**
 * Plex API client factory.
 *
 * Usage:
 *   import { createPlexClient, SECTION_TYPE_MAP } from "@tinkerbell/plex";
 *   const client = createPlexClient({ url, token });
 */

import { createPlexHttp } from "./http.ts";
import { createSectionsModule } from "./sections.ts";
import { createHubsModule } from "./hubs.ts";
import { createItemsModule } from "./items.ts";
import { createMetadataModule } from "./metadata.ts";
import { createCollectionsModule } from "./collections.ts";
import { createSharingModule } from "./sharing.ts";
import { createUsersModule } from "./users.ts";
import { createSessionsModule } from "./sessions.ts";
import { createPostersModule } from "./posters.ts";
import { createStreamingModule } from "./streaming.ts";
import { createPrefsModule } from "./prefs.ts";
import { createPlaylistsModule } from "./playlists.ts";
import type { PlexClientOptions } from "./types.ts";

export { PREROLL_PREF_ID } from "./prefs.ts";
export { PlexApiError } from "./http.ts";
// plex.tv account-level, like `auth.ts` — not part of the server client.
export { fetchWatchlist, removeFromWatchlist, type WatchlistEntry } from "./watchlist.ts";
export {
  parseShareFilter,
  composeShareFilter,
  getFilterClause,
  setFilterClause,
  shareFiltersEqual,
} from "./filters.ts";

export {
  METADATA_FIELDS,
  METADATA_TAG_FIELDS,
  isMetadataField,
  isMetadataTagField,
  sectionTypeForItem,
  type MetadataField,
  type MetadataTagField,
  type MetadataFields,
  type ItemFields,
} from "./metadata.ts";

export { SECTION_TYPE_MAP, COLLECTION_MODES, COLLECTION_SORTS } from "./types.ts";
export type {
  CollectionMode,
  CollectionSort,
  CollectionPrefs,
  PlexSection,
  PlexHub,
  PlexItem,
  PlexHistoryItem,
  PlexCollection,
  PlexCollectionDetail,
  PlexLabel,
  PlexAccount,
  PlexSharing,
  PlexSharedServerDetail,
  PlexSharedServerFull,
  PlexShareSettings,
  PlexShareFilters,
  PlexUserRecord,
  PlexInvite,
  InviteUserOptions,
  PlexHubItem,
  PlexHomeHub,
  PlexSession,
  PlexRecentItem,
  PlexMediaItem,
  PlexStreamInfo,
  PlexPartInfo,
  PlexMediaInfo,
  PlexMediaDetail,
  PlexDirectoryEntry,
  PlexMediaFullDetail,
  PlexPoster,
  PlexPref,
  PlexChildItem,
  MediaFilters,
  PlexHealthCallback,
  PlexClientOptions,
} from "./types.ts";

export function createPlexClient(opts: PlexClientOptions) {
  const http = createPlexHttp(opts);
  return {
    ...createSectionsModule(http),
    ...createHubsModule(http),
    ...createItemsModule(http),
    ...createMetadataModule(http),
    ...createCollectionsModule(http),
    ...createSharingModule(http),
    ...createUsersModule(http),
    ...createSessionsModule(http),
    ...createPostersModule(http),
    ...createStreamingModule(http),
    ...createPrefsModule(http),
    ...createPlaylistsModule(http),
  };
}

export type PlexClient = ReturnType<typeof createPlexClient>;

export {
  createPlexPin,
  buildPlexAuthUrl,
  checkPlexPin,
  getPlexAccount,
  type PlexPin,
  type PlexUserAccount,
} from "./auth.ts";
