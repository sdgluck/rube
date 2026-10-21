/**
 * System status, the app's own health warnings, and disk space.
 */

import type { ServarrHttp } from "@rube/servarr-http";
import type { RadarrDiskSpace, RadarrHealthItem, RadarrSystemStatus } from "./types.ts";

export function createSystem(http: ServarrHttp) {
  return {
    async status(): Promise<{ instanceName: string; version: string; raw: RadarrSystemStatus }> {
      const data = (await http.get<RadarrSystemStatus>("/system/status")) ?? {};
      return {
        instanceName: data.instanceName || data.appName || "Radarr",
        version: data.version || "",
        raw: data,
      };
    },

    /**
     * Radarr's own health warnings — "no download client is available",
     * "indexers are unavailable due to failures".
     *
     * Distinct from Rube's health check, which only asks whether the
     * instance answers at all. This is the instance's opinion of itself, and
     * it is the more useful of the two once something is actually wrong.
     */
    async health(): Promise<RadarrHealthItem[]> {
      return (await http.get<RadarrHealthItem[]>("/health")) ?? [];
    },

    async diskSpace(): Promise<RadarrDiskSpace[]> {
      return (await http.get<RadarrDiskSpace[]>("/diskspace")) ?? [];
    },
  };
}
