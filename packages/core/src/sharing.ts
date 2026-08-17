/**
 * Which libraries a Plex user can actually see.
 *
 * `sync-users` already records this — plex.tv reports the shared sections per
 * user and `plex_user_shares.sectionIds` holds them — but nothing read it, so
 * every list the portal and the per-user digest showed was server-wide. A user
 * shared only "Kids Movies" could search the whole library by title, and was
 * told about films leaving a library they have never been able to open.
 *
 * An empty list means every library, which is the convention the column already
 * documents and what Plex means by an unfiltered share. A user with no share row
 * at all — the owner, or a managed user Plex reports differently — is likewise
 * unrestricted: guessing "nothing" would make their portal look broken, and the
 * owner is the one person for whom server-wide is correct.
 */
import { eq } from "drizzle-orm";
import { db, plexUserShares } from "@tinkerbell/db";

/**
 * Section keys shared with this user, as strings to match `media_items.sectionId`.
 * Empty means "no restriction" — do not filter.
 */
export function sharedSectionKeys(userId: number): string[] {
  const row = db
    .select({ sectionIds: plexUserShares.sectionIds })
    .from(plexUserShares)
    .where(eq(plexUserShares.userId, userId))
    .get();
  return (row?.sectionIds ?? []).map((id) => String(id));
}
