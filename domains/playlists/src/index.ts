import { and, eq } from "drizzle-orm";
import { managedPlaylists, type Db } from "@rube/db";
import { token } from "@rube/container";

/**
 * Which playlists Rube built, and which rule owns each.
 *
 * This exists because **Plex playlists cannot carry labels**. Every other thing
 * this app owns is marked in Plex itself with `Rule:<id>`, which means Plex is
 * the source of truth and the local mirror is only a cache. For playlists there
 * is nowhere to write that mark, so this table *is* the record — and the
 * generate path treats it accordingly: it updates in place, so the worst
 * consequence of losing this table is a duplicate playlist rather than a
 * destroyed one.
 */

export type ManagedPlaylistRow = typeof managedPlaylists.$inferSelect;

export interface RememberPlaylistInput {
  ratingKey: string;
  ruleId: string;
  title: string;
  itemCount: number;
}

export interface PlaylistsDeps {
  db: Db;
}

export function createPlaylists(deps: PlaylistsDeps) {
  const { db } = deps;

  /**
   * The playlist a rule owns under this title.
   *
   * Keyed by title as well as rule because a rule with `combineSections: false`
   * owns one per library, and they have to stay distinguishable across runs.
   */
  function getPlaylistForRule(ruleId: string, title: string): ManagedPlaylistRow | undefined {
    return db
      .select()
      .from(managedPlaylists)
      .where(and(eq(managedPlaylists.ruleId, ruleId), eq(managedPlaylists.title, title)))
      .get();
  }

  function getPlaylistsForRule(ruleId: string): ManagedPlaylistRow[] {
    return db.select().from(managedPlaylists).where(eq(managedPlaylists.ruleId, ruleId)).all();
  }

  function listPlaylists(): ManagedPlaylistRow[] {
    return db.select().from(managedPlaylists).all();
  }

  function rememberPlaylist(input: RememberPlaylistInput): void {
    const now = Date.now();
    db.insert(managedPlaylists)
      .values({ ...input, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: managedPlaylists.ratingKey,
        set: { ruleId: input.ruleId, title: input.title, itemCount: input.itemCount, updatedAt: now },
      })
      .run();
  }

  /** Drop our record of a playlist. Doesn't touch Plex. */
  function forgetPlaylist(ratingKey: string): void {
    db.delete(managedPlaylists).where(eq(managedPlaylists.ratingKey, ratingKey)).run();
  }

  return { getPlaylistForRule, getPlaylistsForRule, listPlaylists, rememberPlaylist, forgetPlaylist };
}

export type Playlists = ReturnType<typeof createPlaylists>;
export const PlaylistsToken = token<Playlists>("playlists");
