/**
 * Per-show episode ordering, and the reads that tell whether it is wrong.
 *
 * Plex's "Plex TV Series" agent numbers episodes from TMDb by default, while
 * Sonarr names files from TheTVDB. Where the two disagree — The Office (US)
 * splits its hour-long episodes in two on TVDB and not on TMDb — every file
 * after the first split lands on the wrong episode in Plex, under the wrong
 * title, and a multi-episode file covers two unrelated entries. The fix is a
 * per-show pref; this module reads and writes it.
 *
 * Shapes checked against a real server (1.42, 2026-10), because none of this
 * is documented and two guesses were wrong:
 *
 * - A show's own ordering rides the section listing as `showOrdering`, and is
 *   absent when the show follows the library. So a whole library's orderings
 *   are one paged listing, not a request per show.
 * - The library default lives in `/library/sections/:id/prefs` and uses a
 *   *different* vocabulary — `aired` means TheTVDB there, where a show says
 *   `tvdbAiring`. `normaliseOrdering` folds the two together.
 * - `GET /library/metadata/:key/prefs` is a 404 for a show; the write is a
 *   `PUT` to the same path, as for collection prefs.
 */
import type { PlexHttp } from "./http.ts";
import { parseMetadataArray } from "./schemas.ts";
import { PLEX_SHOW_TYPE } from "./types.ts";

/** Show-level values Plex offers for `showOrdering`. `""` is "Library default". */
export const SHOW_ORDERINGS = [
  "tmdbAiring",
  "tvdbAiring",
  "tvdbDvd",
  "tvdbAbsolute",
  "tvdbAmazon",
  "tvdbNetflix",
  "tvdbBluRay",
  "tvdbSuperfan",
] as const;
export type ShowOrdering = (typeof SHOW_ORDERINGS)[number];

/**
 * A library- or show-level ordering value, in the show-level vocabulary.
 *
 * The library pref spells TheTVDB's aired order `aired`; everything else is
 * already in the show form. Unknown values pass through rather than being
 * dropped, so a future Plex ordering reads as "some ordering" rather than none.
 */
export function normaliseOrdering(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "aired") return "tvdbAiring";
  return value;
}

/** Whether an ordering numbers episodes the way Sonarr (TheTVDB) does. */
export function isTvdbOrdering(value: string | null | undefined): boolean {
  return normaliseOrdering(value)?.startsWith("tvdb") ?? false;
}

export interface PlexShowSummary {
  ratingKey: string;
  title: string;
  /** The agent's own id: `plex://show/…` on the modern agent, `com.plexapp.agents.…` on a legacy one. */
  guid: string | null;
  /** The show's own ordering, or null when it follows the library. */
  ordering: string | null;
}

export interface PlexLeaf {
  ratingKey: string;
  season: number;
  episode: number;
  title: string;
  /** Server-side paths of every part. Two leaves sharing one is a multi-episode file. */
  files: string[];
}

export function createShowsModule(http: PlexHttp) {
  /** Every show in a section, with the ordering and agent each one uses. */
  async function sectionShows(sectionId: string): Promise<PlexShowSummary[]> {
    const shows: PlexShowSummary[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const data = await http.request(`/library/sections/${sectionId}/all`, {
        params: { type: PLEX_SHOW_TYPE, "X-Plex-Container-Start": offset, "X-Plex-Container-Size": pageSize },
      });
      const rows = parseMetadataArray(data?.MediaContainer?.Metadata);
      for (const row of rows) {
        if (!row.ratingKey) continue;
        shows.push({
          ratingKey: row.ratingKey,
          title: row.title ?? "",
          guid: row.guid ?? null,
          ordering: normaliseOrdering(row.showOrdering),
        });
      }
      if (rows.length < pageSize) break;
    }
    return shows;
  }

  /** The ordering a section's shows follow unless they say otherwise. */
  async function sectionOrdering(sectionId: string): Promise<string | null> {
    const data = await http.request(`/library/sections/${sectionId}/prefs`);
    const settings: Array<{ id?: string; value?: unknown }> = data?.MediaContainer?.Setting ?? [];
    const value = settings.find((s) => s.id === "showOrdering")?.value;
    return normaliseOrdering(typeof value === "string" ? value : null);
  }

  /** Every episode of a show that has a file, with its numbering as Plex sees it. */
  async function showLeaves(ratingKey: string): Promise<PlexLeaf[]> {
    const data = await http.request(`/library/metadata/${ratingKey}/allLeaves`);
    return parseMetadataArray(data?.MediaContainer?.Metadata)
      .filter((m) => typeof m.parentIndex === "number" && typeof m.index === "number")
      .map((m) => ({
        ratingKey: m.ratingKey ?? "",
        season: m.parentIndex as number,
        episode: m.index as number,
        title: m.title ?? "",
        files: (m.Media ?? []).flatMap((media) => (media.Part ?? []).map((p) => p.file ?? "")).filter(Boolean),
      }));
  }

  /** Set one show's episode ordering. Takes effect on the next metadata refresh. */
  async function setShowOrdering(ratingKey: string, ordering: ShowOrdering): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}/prefs`, { method: "PUT", params: { showOrdering: ordering } });
  }

  /**
   * Scan one folder of a section rather than the whole library.
   *
   * For an import Plex missed: the *Arr has the file, Plex never noticed. A
   * full scan would find it too, at the cost of walking every other folder.
   */
  async function scanPath(sectionId: string, path: string): Promise<void> {
    await http.request(`/library/sections/${sectionId}/refresh`, { params: { path } });
  }

  /** Re-run media analysis on an item, which is what fills in a part's size and stream details. */
  async function analyzeItem(ratingKey: string): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}/analyze`, { method: "PUT" });
  }

  return { sectionShows, sectionOrdering, showLeaves, setShowOrdering, scanPath, analyzeItem };
}
