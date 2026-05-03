import type { PlexHttp } from "./http.ts";
import type { PlexSection } from "./types.ts";

export function createSectionsModule(http: PlexHttp) {
  async function getSections(): Promise<PlexSection[]> {
    const data = await http.request("/library/sections");
    return data.MediaContainer.Directory || [];
  }

  async function getIdentity(): Promise<{ friendlyName: string; machineIdentifier: string }> {
    const data = await http.request("/");
    return data.MediaContainer;
  }

  return { getSections, getIdentity };
}
