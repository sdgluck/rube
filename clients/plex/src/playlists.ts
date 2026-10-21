import { PlexApiError, type PlexHttp } from "./http.ts";
import { chunkRatingKeys, libraryUri } from "./uri.ts";
import type { PlexItem } from "./types.ts";

/**
 * Plex playlists.
 *
 * Two things make playlists different from collections in ways that reach all
 * the way up into how a rule is committed:
 *
 *  - **They're ordered.** A collection is a set; a playlist is a sequence, and
 *    the sequence is usually the whole point ("watch these in this order").
 *    Every function here preserves the order it's given.
 *  - **They can't be labelled.** Collections carry `Rule:<id>`, which is how
 *    Rube knows what it owns. Playlists have no labels, so ownership is
 *    tracked locally and mirrored into the summary as a fallback.
 *
 * The second is why nothing here deletes and recreates. A playlist's rating key
 * is the only durable handle anybody has on it — including Plex clients that
 * have it in a "continue watching" row — so an update clears and refills in
 * place rather than making a new one.
 */

/** True for the 404 Plex returns once a rating key no longer exists. */
function isGone(err: unknown): boolean {
  return err instanceof PlexApiError && err.status === 404;
}

export interface PlexPlaylist {
  ratingKey: string;
  title: string;
  summary: string;
  itemCount: number;
  /** `video`, `audio` or `photo`. */
  playlistType: string;
  smart: boolean;
}

export interface CreatePlaylistOptions {
  title: string;
  machineId: string;
  ratingKeys: string[];
  /** Plex's own kind. Video covers both films and episodes. */
  type?: "video" | "audio" | "photo";
}

function toPlaylist(meta: Record<string, unknown>): PlexPlaylist {
  return {
    ratingKey: String(meta.ratingKey),
    title: String(meta.title ?? ""),
    summary: String(meta.summary ?? ""),
    itemCount: Number(meta.leafCount ?? 0),
    playlistType: String(meta.playlistType ?? "video"),
    smart: meta.smart === "1" || meta.smart === 1 || meta.smart === true,
  };
}

export function createPlaylistsModule(http: PlexHttp) {
  /** Every playlist on the server. Playlists aren't library-scoped. */
  async function getPlaylists(): Promise<PlexPlaylist[]> {
    const data = await http.request("/playlists");
    const metadata: Array<Record<string, unknown>> = data?.MediaContainer?.Metadata || [];
    return metadata.map(toPlaylist);
  }

  async function getPlaylist(ratingKey: string): Promise<PlexPlaylist | null> {
    try {
      const data = await http.request(`/playlists/${ratingKey}`);
      const meta = data?.MediaContainer?.Metadata?.[0];
      return meta ? toPlaylist(meta) : null;
    } catch (err) {
      if (isGone(err)) return null;
      throw err;
    }
  }

  async function getPlaylistItems(ratingKey: string): Promise<PlexItem[]> {
    try {
      const data = await http.request(`/playlists/${ratingKey}/items`);
      const metadata = data?.MediaContainer?.Metadata || [];
      return metadata.map((item: { ratingKey: string; title: string; year?: number; thumb?: string }) => ({
        ratingKey: item.ratingKey,
        title: item.title,
        year: item.year,
        thumb: item.thumb,
      }));
    } catch (err) {
      if (isGone(err)) return [];
      throw err;
    }
  }

  /**
   * Create a playlist holding the given items, in the given order.
   *
   * Long playlists are created from the first chunk and extended: the rating
   * keys go into the URI, which is a path segment, so a five-hundred-item
   * playlist would otherwise be a request line long enough for a proxy in front
   * of Plex to reject — and it would reject it with something unhelpful.
   */
  async function createPlaylist(opts: CreatePlaylistOptions): Promise<string | null> {
    const { title, machineId, ratingKeys, type = "video" } = opts;
    if (ratingKeys.length === 0) return null;

    const chunks = chunkRatingKeys(ratingKeys);
    const data = await http.request("/playlists", {
      method: "POST",
      params: {
        type,
        title,
        smart: 0,
        uri: libraryUri(machineId, chunks[0]!),
      },
    });

    const ratingKey = data?.MediaContainer?.Metadata?.[0]?.ratingKey;
    if (!ratingKey) throw new Error(`Plex did not return a rating key for playlist "${title}"`);

    for (const chunk of chunks.slice(1)) {
      await addToPlaylist(String(ratingKey), machineId, chunk);
    }
    return String(ratingKey);
  }

  /** Append items, preserving order. */
  async function addToPlaylist(ratingKey: string, machineId: string, itemRatingKeys: string[]): Promise<void> {
    if (itemRatingKeys.length === 0) return;
    for (const chunk of chunkRatingKeys(itemRatingKeys)) {
      await http.request(`/playlists/${ratingKey}/items`, {
        method: "PUT",
        params: { uri: libraryUri(machineId, chunk) },
      });
    }
  }

  /** Remove every item, keeping the playlist (and its rating key) alive. */
  async function clearPlaylist(ratingKey: string): Promise<void> {
    await http.request(`/playlists/${ratingKey}/items`, { method: "DELETE" });
  }

  async function deletePlaylist(ratingKey: string): Promise<boolean> {
    try {
      await http.request(`/playlists/${ratingKey}`, { method: "DELETE" });
      return true;
    } catch (err) {
      if (isGone(err)) return false;
      throw err;
    }
  }

  async function updatePlaylist(ratingKey: string, updates: { title?: string; summary?: string }): Promise<void> {
    const params: Record<string, string> = {};
    if (updates.title !== undefined) params.title = updates.title;
    if (updates.summary !== undefined) params.summary = updates.summary;
    if (Object.keys(params).length === 0) return;
    await http.request(`/playlists/${ratingKey}`, { method: "PUT", params });
  }

  return {
    getPlaylists,
    getPlaylist,
    getPlaylistItems,
    createPlaylist,
    addToPlaylist,
    clearPlaylist,
    deletePlaylist,
    updatePlaylist,
  };
}
