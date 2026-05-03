/**
 * Configured client factories. Each one reads server config and wires
 * up the client's `onHealth` callback to our health domain.
 */

import { createPlexClient, type PlexHealthCallback } from "@tinkerbell/plex";
import { createOmdbClient } from "@tinkerbell/omdb";
import { createImdbClient } from "@tinkerbell/imdb";
import { getConfig } from "./config.ts";
import { reportHealth } from "../domains/health.ts";

export const plexHealthCallback: PlexHealthCallback = (service, status, message) =>
  reportHealth(service, status, message);

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
    onHealth: (status, message) => reportHealth("OMDB", status, message),
  });
}

export function getImdbClient() {
  return createImdbClient({
    onHealth: (status, message) => reportHealth("IMDb", status, message),
  });
}
