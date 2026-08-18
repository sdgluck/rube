/**
 * The per-user detail view.
 *
 * Deliberately reads plex.tv live rather than serving `plex_user_shares`.
 * Shares change out-of-band — someone edits them in the Plex web app, or the
 * personalization job rewrites a filter — and a stale library list that
 * silently lies is worse than a slower page. The cached row still supplies
 * the parts that only Tinkerbell knows (friendly name, collection count,
 * portal opt-in).
 */

import { getFilterClause } from "@tinkerbell/plex";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import type { Db } from "@tinkerbell/db";
import { createQuery, type LocalUser } from "./query.ts";
import { type ConfigStore } from "@tinkerbell/core";

export interface UserShareState {
  /** Null when the server isn't shared with them (Home users often aren't). */
  sharedServerId: number | null;
  accepted: boolean;
  allowSync: boolean;
  allowTuners: boolean;
  allowChannels: boolean;
  allowCameraUpload: boolean;
  /** Empty means every library. */
  librarySectionIds: number[];
  /** Content ratings the user is limited to, per media type. */
  contentRatingMovies: string[];
  contentRatingTelevision: string[];
  /** The label clause. Owned by personalization while it is enabled. */
  labelsMovies: string[];
  labelsTelevision: string[];
}

export interface UserDetail {
  user: LocalUser;
  share: UserShareState | null;
  sections: PlexSection[];
  /**
   * Personalized home screens rewrite every shared user's label filters, so
   * while it is on (or mid-flight) the label editor has to stand down. The UI
   * reads this rather than re-deriving it.
   */
  personalization: { status: string; ownsLabels: boolean };
}

export interface DetailDeps {
  db: Db;
  config: ConfigStore;
}
export function createDetail(deps: DetailDeps) {
  const { getLocalUser } = createQuery(deps);
  const { getPersonalizedSharingStatus } = deps.config;

  async function getUserDetail(client: PlexClient, userId: number): Promise<UserDetail | null> {
    const user = getLocalUser(userId);
    if (!user) return null;

    const identity = await client.getIdentity();
    const [shares, sections] = await Promise.all([
      client.getSharedServersFull(identity.machineIdentifier).catch(() => []),
      client.getSections().catch(() => [] as PlexSection[]),
    ]);

    const found = shares.find((s) => s.userId === userId);
    const share: UserShareState | null = found
      ? {
          sharedServerId: found.sharedServerId,
          accepted: found.accepted,
          allowSync: found.allowSync,
          allowTuners: found.allowTuners,
          allowChannels: found.allowChannels,
          allowCameraUpload: found.allowCameraUpload,
          librarySectionIds: found.librarySectionIds,
          contentRatingMovies: getFilterClause(found.filterMovies, "contentRating"),
          contentRatingTelevision: getFilterClause(found.filterTelevision, "contentRating"),
          labelsMovies: getFilterClause(found.filterMovies, "label"),
          labelsTelevision: getFilterClause(found.filterTelevision, "label"),
        }
      : null;

    const status = getPersonalizedSharingStatus();

    return {
      user,
      share,
      sections,
      personalization: { status, ownsLabels: status !== "disabled" },
    };
  }

  return { getUserDetail };
}
