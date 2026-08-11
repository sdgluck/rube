/**
 * Configured client factories. Each one reads server config and forwards
 * health events through a registered reporter (set by the health domain
 * at startup) — this keeps core free of a back-edge to domains/health.
 */

import { createPlexClient, type PlexHealthCallback } from "@tinkerbell/plex";
import { createOmdbClient } from "@tinkerbell/omdb";
import { createImdbClient } from "@tinkerbell/imdb";
import { getConfig } from "./config.ts";

/**
 * Thrown when a client is asked for before its credentials exist. This is a
 * state the user can resolve in Settings, not a fault, so callers that speak
 * HTTP map it to 412 rather than letting it fall through as a 500 — see the
 * `getPlexClient` wrapper in `@tinkerbell/trpc`'s `_base.ts`. Core stays free
 * of any dependency on the transport by naming the condition and no more.
 */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

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
    throw new NotConfiguredError("Plex URL and token are not configured");
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
