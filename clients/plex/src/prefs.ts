import type { PlexHttp } from "./http.ts";
import type { PlexPref } from "./types.ts";

/**
 * The server preference holding the pre-roll path list. Despite the name it
 * has nothing to do with trailers or IDs — it's a delimited list of absolute
 * paths on the Plex server's own filesystem.
 */
export const PREROLL_PREF_ID = "CinemaTrailersPrerollID";

export function createPrefsModule(http: PlexHttp) {
  async function getPrefs(): Promise<PlexPref[]> {
    const data = await http.request("/:/prefs");
    return data?.MediaContainer?.Setting || [];
  }

  /**
   * Plex takes preference writes as query parameters on a PUT, one parameter
   * per setting. There's no JSON body form.
   */
  async function setPref(id: string, value: string): Promise<void> {
    await http.request("/:/prefs", { method: "PUT", params: { [id]: value } });
  }

  /** Current pre-roll path list, or "" when unset. */
  async function getPrerollPref(): Promise<string> {
    const prefs = await getPrefs();
    const pref = prefs.find((p) => p.id === PREROLL_PREF_ID);
    if (pref?.value === undefined || pref.value === null) return "";
    return String(pref.value);
  }

  async function setPrerollPref(value: string): Promise<void> {
    await setPref(PREROLL_PREF_ID, value);
  }

  return { getPrefs, setPref, getPrerollPref, setPrerollPref };
}
