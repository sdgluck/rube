/**
 * Sonarr's own configuration — all four areas.
 *
 * Reads are plain. Writes are deliberately **not** exposed as a "replace this
 * whole area" verb: everything here is create/update/delete on individual
 * records, because a bulk replace is indistinguishable from a clobber. The
 * planning, diffing and snapshotting that decides *which* of those to call
 * lives above this, in `domains/arr-settings`.
 */

import type { ServarrHttp, ServarrProvider } from "@rube/servarr-http";
import type {
  SonarrCustomFormat,
  SonarrCustomFormatSpecification,
  SonarrQualityDefinition,
  SonarrQualityProfile,
  SonarrRootFolder,
  SonarrTag,
} from "./types.ts";

/** The four groupings the UI and the snapshot format are organised by. */
export const SONARR_SETTINGS_AREAS = ["profiles", "media", "indexers", "general"] as const;
export type SonarrSettingsArea = (typeof SONARR_SETTINGS_AREAS)[number];

/**
 * Which endpoints make up each area.
 *
 * A snapshot is a map of these paths to the documents they returned, so this
 * table is the definition of "what a settings area *is*" for both the snapshot
 * and the diff. Adding an endpoint here puts it under version control
 * automatically.
 */
export const SONARR_AREA_ENDPOINTS: Record<SonarrSettingsArea, string[]> = {
  // `languageprofile` is Sonarr v3 only and `customformat` is v4 only — the two
  // are near-mutually-exclusive across versions, so both are listed and the
  // reader tolerates a 404 from whichever this instance does not have. See
  // `readArea`, which records the error per endpoint rather than failing.
  profiles: [
    "/qualityprofile",
    "/qualitydefinition",
    "/customformat",
    "/languageprofile",
    "/releaseprofile",
    "/delayprofile",
  ],
  media: ["/rootfolder", "/config/naming", "/config/mediamanagement", "/importlist", "/metadata"],
  indexers: ["/indexer", "/config/indexer", "/downloadclient", "/config/downloadclient", "/remotepathmapping"],
  general: ["/tag", "/notification", "/config/host", "/config/ui"],
};

export function createSettings(http: ServarrHttp) {
  return {
    // ── Profiles & quality ───────────────────────────────────────────────
    qualityProfiles: () => http.get<SonarrQualityProfile[]>("/qualityprofile"),
    qualityProfile: (id: number) => http.get<SonarrQualityProfile>(`/qualityprofile/${id}`),
    qualityProfileSchema: () => http.get<SonarrQualityProfile>("/qualityprofile/schema"),
    createQualityProfile: (profile: unknown) => http.post<SonarrQualityProfile>("/qualityprofile", profile),
    updateQualityProfile: (id: number, profile: unknown) =>
      http.put<SonarrQualityProfile>(`/qualityprofile/${id}`, profile),
    deleteQualityProfile: (id: number) => http.del(`/qualityprofile/${id}`),

    qualityDefinitions: () => http.get<SonarrQualityDefinition[]>("/qualitydefinition"),
    updateQualityDefinitions: (definitions: SonarrQualityDefinition[]) =>
      http.put<SonarrQualityDefinition[]>("/qualitydefinition/update", definitions),

    customFormats: () => http.get<SonarrCustomFormat[]>("/customformat"),
    /** One template per specification implementation this instance supports. */
    customFormatSchema: () => http.get<SonarrCustomFormatSpecification[]>("/customformat/schema"),
    createCustomFormat: (format: SonarrCustomFormat) => http.post<SonarrCustomFormat>("/customformat", format),
    updateCustomFormat: (id: number, format: SonarrCustomFormat) =>
      http.put<SonarrCustomFormat>(`/customformat/${id}`, format),
    deleteCustomFormat: (id: number) => http.del(`/customformat/${id}`),

    delayProfiles: () => http.get<unknown[]>("/delayprofile"),
    updateDelayProfile: (id: number, profile: unknown) => http.put(`/delayprofile/${id}`, profile),

    // ── Media management ─────────────────────────────────────────────────
    rootFolders: () => http.get<SonarrRootFolder[]>("/rootfolder"),
    createRootFolder: (path: string) => http.post<SonarrRootFolder>("/rootfolder", { path }),
    deleteRootFolder: (id: number) => http.del(`/rootfolder/${id}`),

    naming: () => http.get<Record<string, unknown>>("/config/naming"),
    updateNaming: (config: unknown) => http.put("/config/naming", config),
    /** Renders the naming tokens against a sample, for a live preview. */
    namingExamples: (config: Record<string, unknown>) =>
      http.get<Record<string, string>>("/config/naming/examples", {
        params: config as Record<string, string | number | boolean>,
      }),

    mediaManagement: () => http.get<Record<string, unknown>>("/config/mediamanagement"),
    updateMediaManagement: (config: unknown) => http.put("/config/mediamanagement", config),

    importLists: () => http.get<ServarrProvider[]>("/importlist"),
    importListSchema: () => http.get<ServarrProvider[]>("/importlist/schema"),
    createImportList: (list: unknown) => http.post("/importlist", list),
    updateImportList: (id: number, list: unknown) => http.put(`/importlist/${id}`, list),
    deleteImportList: (id: number) => http.del(`/importlist/${id}`),
    testImportList: (list: unknown) => http.raw("POST", "/importlist/test", list, { timeoutMs: 60_000 }),

    metadataConsumers: () => http.get<ServarrProvider[]>("/metadata"),
    updateMetadataConsumer: (id: number, consumer: unknown) => http.put(`/metadata/${id}`, consumer),

    // ── Indexers & download clients ──────────────────────────────────────
    indexers: () => http.get<ServarrProvider[]>("/indexer"),
    indexerSchema: () => http.get<ServarrProvider[]>("/indexer/schema"),
    createIndexer: (indexer: unknown) => http.post("/indexer", indexer),
    updateIndexer: (id: number, indexer: unknown) => http.put(`/indexer/${id}`, indexer),
    deleteIndexer: (id: number) => http.del(`/indexer/${id}`),
    /**
     * Test an indexer. Returns the raw result rather than throwing, because a
     * failing test is the expected answer half the time it is asked for and
     * the body carries the reason.
     */
    testIndexer: (indexer: unknown) => http.raw("POST", "/indexer/test", indexer, { timeoutMs: 60_000 }),

    indexerConfig: () => http.get<Record<string, unknown>>("/config/indexer"),
    updateIndexerConfig: (config: unknown) => http.put("/config/indexer", config),

    downloadClients: () => http.get<ServarrProvider[]>("/downloadclient"),
    downloadClientSchema: () => http.get<ServarrProvider[]>("/downloadclient/schema"),
    createDownloadClient: (client: unknown) => http.post("/downloadclient", client),
    updateDownloadClient: (id: number, client: unknown) => http.put(`/downloadclient/${id}`, client),
    deleteDownloadClient: (id: number) => http.del(`/downloadclient/${id}`),
    testDownloadClient: (client: unknown) => http.raw("POST", "/downloadclient/test", client, { timeoutMs: 60_000 }),

    downloadClientConfig: () => http.get<Record<string, unknown>>("/config/downloadclient"),
    updateDownloadClientConfig: (config: unknown) => http.put("/config/downloadclient", config),

    remotePathMappings: () => http.get<unknown[]>("/remotepathmapping"),
    createRemotePathMapping: (mapping: unknown) => http.post("/remotepathmapping", mapping),
    updateRemotePathMapping: (id: number, mapping: unknown) => http.put(`/remotepathmapping/${id}`, mapping),
    deleteRemotePathMapping: (id: number) => http.del(`/remotepathmapping/${id}`),

    // ── Tags, connections, general ───────────────────────────────────────
    tags: () => http.get<SonarrTag[]>("/tag"),
    createTag: (label: string) => http.post<SonarrTag>("/tag", { label }),
    deleteTag: (id: number) => http.del(`/tag/${id}`),

    notifications: () => http.get<ServarrProvider[]>("/notification"),
    notificationSchema: () => http.get<ServarrProvider[]>("/notification/schema"),
    createNotification: (notification: unknown) => http.post("/notification", notification),
    updateNotification: (id: number, notification: unknown) => http.put(`/notification/${id}`, notification),
    deleteNotification: (id: number) => http.del(`/notification/${id}`),
    testNotification: (notification: unknown) =>
      http.raw("POST", "/notification/test", notification, { timeoutMs: 60_000 }),

    hostConfig: () => http.get<Record<string, unknown>>("/config/host"),
    updateHostConfig: (config: unknown) => http.put("/config/host", config),

    uiConfig: () => http.get<Record<string, unknown>>("/config/ui"),
    updateUiConfig: (config: unknown) => http.put("/config/ui", config),

    // ── Sonarr-only ──────────────────────────────────────────────────────
    //
    // Neither of these has a Radarr equivalent, which is why the settings
    // clients are separate files rather than one parameterised by service.

    /** Sonarr v3 only. Removed in v4, where languages moved into quality profiles. */
    languageProfiles: () => http.get<unknown[]>("/languageprofile"),
    updateLanguageProfile: (id: number, profile: unknown) => http.put(`/languageprofile/${id}`, profile),

    /** Release profiles — preferred/ignored term lists. Sonarr only. */
    releaseProfiles: () => http.get<unknown[]>("/releaseprofile"),
    createReleaseProfile: (profile: unknown) => http.post("/releaseprofile", profile),
    updateReleaseProfile: (id: number, profile: unknown) => http.put(`/releaseprofile/${id}`, profile),
    deleteReleaseProfile: (id: number) => http.del(`/releaseprofile/${id}`),

    /**
     * Read every endpoint in an area, as a snapshot payload.
     *
     * Endpoints are read **sequentially**, not in parallel. An area is at most
     * five requests against one instance, and firing them at once on a box
     * that is already busy indexing is how a settings page becomes the thing
     * that tips it over.
     *
     * A failing endpoint records its error rather than failing the whole
     * snapshot: an instance where one section is broken is exactly the
     * instance somebody most needs to see the rest of.
     */
    async readArea(area: SonarrSettingsArea): Promise<Record<string, unknown>> {
      const out: Record<string, unknown> = {};
      for (const path of SONARR_AREA_ENDPOINTS[area]) {
        try {
          out[path] = await http.get<unknown>(path);
        } catch (err) {
          out[path] = { __error: err instanceof Error ? err.message : String(err) };
        }
      }
      return out;
    },
  };
}
