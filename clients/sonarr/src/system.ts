/**
 * System status, the app's own health warnings, and disk space.
 */

import type { ServarrHttp } from "@rube/servarr-http";
import type { SonarrDiskSpace, SonarrHealthItem, SonarrSystemStatus } from "./types.ts";

export function createSystem(http: ServarrHttp) {
  return {
    async status(): Promise<{ instanceName: string; version: string; raw: SonarrSystemStatus }> {
      const data = (await http.get<SonarrSystemStatus>("/system/status")) ?? {};
      return {
        instanceName: data.instanceName || data.appName || "Sonarr",
        version: data.version || "",
        raw: data,
      };
    },

    /**
     * Sonarr's own health warnings — "no download client is available",
     * "indexers are unavailable due to failures".
     *
     * Distinct from Rube's health check, which only asks whether the
     * instance answers at all. This is the instance's opinion of itself, and
     * it is the more useful of the two once something is actually wrong.
     */
    async health(): Promise<SonarrHealthItem[]> {
      return (await http.get<SonarrHealthItem[]>("/health")) ?? [];
    },

    async diskSpace(): Promise<SonarrDiskSpace[]> {
      return (await http.get<SonarrDiskSpace[]>("/diskspace")) ?? [];
    },
  };
}
