/**
 * Configured client factories. Each one reads server config and forwards
 * health events to the reporter it was built with.
 *
 * That reporter used to be a module-level `let` defaulting to `() => {}`, set
 * by `domains/health` at startup via `setHealthReporter`. The default is what
 * made the Sidequest worker bug invisible: the worker thread has its own module
 * graph, nothing called the setter there, and every health event raised by
 * every client during every job went to a no-op — silently, for as long as the
 * jobs have existed. Injecting it means a container that fails to provide one
 * cannot resolve at all.
 */

import { token } from "@tinkerbell/container";
import { createPlexClient } from "@tinkerbell/plex";
import { createOmdbClient } from "@tinkerbell/omdb";
import { createImdbClient } from "@tinkerbell/imdb";
import type { HealthReporter } from "@tinkerbell/ports";
import type { Db } from "@tinkerbell/db";
import type { ConfigStore } from "./config.ts";

/**
 * Thrown when a client is asked for before its credentials exist. This is a
 * state the user can resolve in Settings, not a fault, so callers that speak
 * HTTP map it to 412 rather than letting it fall through as a 500 — see
 * `mapNotConfiguredClient` in `@tinkerbell/trpc`'s `_base.ts`. Core stays free
 * of any dependency on the transport by naming the condition and no more.
 */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

export interface ClientsDeps {
  config: ConfigStore;
  health: HealthReporter;
  /** The OMDb client caches its lookups, so it needs the connection. */
  db: Db;
}

export function createClients(deps: ClientsDeps) {
  const { getConfig } = deps.config;
  const { health } = deps;

  /** Passed to the Plex client so its own probes land on the same reporter. */
  const plexHealthCallback = (service: string, status: "ok" | "error", message: string) =>
    health(service, status, message);

  function getPlexClient(opts: { signal?: AbortSignal } = {}) {
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

  function getOmdbClient() {
    return createOmdbClient({
      db: deps.db,
      apiKey: getConfig("global_omdb_api_key") ?? null,
      onHealth: (status, message) => health("OMDB", status, message),
    });
  }

  function getImdbClient() {
    return createImdbClient({
      onHealth: (status, message) => health("IMDb", status, message),
    });
  }

  return { getPlexClient, getOmdbClient, getImdbClient, plexHealthCallback };
}

export type Clients = ReturnType<typeof createClients>;

export const ClientsToken = token<Clients>("clients");
