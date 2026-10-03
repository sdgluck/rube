import type { PlexHttp } from "./http.ts";
import type { PlexSection } from "./types.ts";

export function createSectionsModule(http: PlexHttp) {
  async function getSections(): Promise<PlexSection[]> {
    const data = await http.request("/library/sections");
    return data.MediaContainer.Directory || [];
  }

  async function getIdentity(): Promise<{
    friendlyName: string;
    machineIdentifier: string;
    myPlexSubscription?: boolean | string | number;
  }> {
    const data = await http.request("/");
    return data.MediaContainer;
  }

  /**
   * Whether the server's owner has an active Plex Pass, as the server itself
   * reports it. Asked of the media server rather than plex.tv because it is
   * the server that decides whether to play pre-rolls, and its root already
   * carries the flag — no second token or account call. Plex has served it as
   * a boolean and as "1" across versions, so both count.
   */
  async function hasPlexPass(): Promise<boolean> {
    const { myPlexSubscription: v } = await getIdentity();
    return v === true || v === 1 || v === "1" || v === "true";
  }

  return { getSections, getIdentity, hasPlexPass };
}
