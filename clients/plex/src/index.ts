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
import { createCollectionsModule } from "./collections.ts";
import { createSharingModule } from "./sharing.ts";
import { createSessionsModule } from "./sessions.ts";
import { createPostersModule } from "./posters.ts";
import { createStreamingModule } from "./streaming.ts";
import { createPrefsModule } from "./prefs.ts";
import type { PlexClientOptions } from "./types.ts";

export { PREROLL_PREF_ID } from "./prefs.ts";
export { PlexApiError } from "./http.ts";

export { SECTION_TYPE_MAP } from "./types.ts";
export type {
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
    ...createCollectionsModule(http),
    ...createSharingModule(http),
    ...createSessionsModule(http),
    ...createPostersModule(http),
    ...createStreamingModule(http),
    ...createPrefsModule(http),
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
