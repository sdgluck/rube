/**
 * Reading an instance's quality settings, and the client behind it.
 *
 * The one place this package touches a real *Arr client. Everything above it
 * talks to `QualityApi`, which is what lets the planner stay pure and the
 * tests swap the instance for a mock server without stubbing `fetch`.
 */

import type { ArrInstance } from "@rube/core";
import { capabilitiesFor as radarrCapabilities, createRadarrClient, type RadarrClient } from "@rube/radarr";
import { capabilitiesFor as sonarrCapabilities, createSonarrClient, type SonarrClient } from "@rube/sonarr";
import type { LiveQuality, QualityApi, WireCustomFormat, WireDefinition, WireProfile, WireSpec } from "./wire.ts";

export type ArrClient = RadarrClient | SonarrClient;

export function clientFor(instance: ArrInstance, signal?: AbortSignal): ArrClient {
  const opts = { url: instance.url, apiKey: instance.apiKey, signal };
  return instance.service === "radarr" ? createRadarrClient(opts) : createSonarrClient(opts);
}

/**
 * The quality calls, typed for the planner.
 *
 * The casts are where the per-app types meet the shared wire shape. They are
 * structurally the same document (see `wire.ts`), and this is the one place
 * that says so.
 */
export function qualityApiFor(instance: ArrInstance, client: ArrClient): QualityApi {
  const s = client.settings;
  const capabilities = instance.service === "radarr" ? radarrCapabilities : sonarrCapabilities;
  return {
    status: () => client.system.status(),
    capabilities: (version) => capabilities(version),
    qualityProfiles: () => s.qualityProfiles() as Promise<WireProfile[]>,
    qualityProfileSchema: () => s.qualityProfileSchema() as Promise<WireProfile>,
    createQualityProfile: (p) => s.createQualityProfile(p) as Promise<WireProfile>,
    updateQualityProfile: (id, p) => s.updateQualityProfile(id, p) as Promise<WireProfile>,
    deleteQualityProfile: (id) => s.deleteQualityProfile(id),
    qualityDefinitions: () => s.qualityDefinitions() as Promise<WireDefinition[]>,
    updateQualityDefinitions: (d) => s.updateQualityDefinitions(d as never),
    customFormats: () => s.customFormats() as Promise<WireCustomFormat[]>,
    customFormatSchema: () => s.customFormatSchema() as Promise<WireSpec[]>,
    createCustomFormat: (f) => s.createCustomFormat(f as never) as Promise<WireCustomFormat>,
    updateCustomFormat: (id, f) => s.updateCustomFormat(id, f as never) as Promise<WireCustomFormat>,
    deleteCustomFormat: (id) => s.deleteCustomFormat(id),
    readProfilesArea: () => s.readArea("profiles"),
  };
}

/**
 * Everything the planner needs, read sequentially.
 *
 * Sequential for the reason `readArea` gives: six requests at once against a
 * box that is busy importing is how a settings page becomes the thing that
 * tips it over. Custom format endpoints are skipped where the capability is
 * absent, rather than read and allowed to 404, so the error a Sonarr v3 user
 * sees is the planner's sentence about versions and not a gateway error.
 */
export async function readLive(api: QualityApi): Promise<LiveQuality> {
  const { version } = await api.status();
  const capabilities = api.capabilities(version);
  const hasFormats = capabilities.includes("customFormats");
  const profileSchema = await api.qualityProfileSchema();
  const profiles = await api.qualityProfiles();
  const customFormats = hasFormats ? await api.customFormats() : [];
  const specSchema = hasFormats ? await api.customFormatSchema() : [];
  const definitions = await api.qualityDefinitions();
  return { version, capabilities, profileSchema, profiles, customFormats, specSchema, definitions };
}
