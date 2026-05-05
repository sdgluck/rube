/**
 * Configured client factories. Each one reads server config and forwards
 * health events through a registered reporter (set by the health domain
 * at startup) — this keeps core free of a back-edge to domains/health.
 */

import { createPlexClient, type PlexHealthCallback } from "@tinkerbell/plex";
import { createOmdbClient } from "@tinkerbell/omdb";
import { createImdbClient } from "@tinkerbell/imdb";
import { getConfig } from "./config.ts";

type HealthReporter = (service: string, status: "ok" | "error", message: string) => void;

let reporter: HealthReporter = () => {};

export function setHealthReporter(next: HealthReporter): void {
  reporter = next;
}

export const plexHealthCallback: PlexHealthCallback = (service, status, message) => reporter(service, status, message);

export function getPlexClient(opts: { signal?: AbortSignal } = {}) {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) {
    throw new Error("Plex URL and token are not configured");
  }
  return createPlexClient({
    url: plexUrl,
    token: plexToken,
    signal: opts.signal,
    onHealth: plexHealthCallback,
  });
}

export function getOmdbClient() {
  return createOmdbClient({
    apiKey: getConfig("global_omdb_api_key") ?? null,
    onHealth: (status, message) => reporter("OMDB", status, message),
  });
}

export function getImdbClient() {
  return createImdbClient({
    onHealth: (status, message) => reporter("IMDb", status, message),
  });
}
