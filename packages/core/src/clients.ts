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
import { createMdblistClient } from "@tinkerbell/mdblist";
import { createTraktClient } from "@tinkerbell/trakt";
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

  /**
   * MDBList and Trakt take their key at construction rather than per call, and
   * a missing key is not an error here — both throw a message naming the
   * setting when actually asked for something. `NotConfiguredError` is
   * deliberately not used: these are reached from inside a job, where the
   * plain message is what lands in the run log.
   */
  function getMdblistClient() {
    return createMdblistClient({
      apiKey: getConfig("global_mdblist_api_key") ?? null,
      onHealth: (status, message) => health("MDBList", status, message),
    });
  }

  function getTraktClient() {
    return createTraktClient({
      clientId: getConfig("global_trakt_client_id") ?? null,
      onHealth: (status, message) => health("Trakt", status, message),
    });
  }

  return { getPlexClient, getOmdbClient, getImdbClient, getMdblistClient, getTraktClient, plexHealthCallback };
}

export type Clients = ReturnType<typeof createClients>;

export const ClientsToken = token<Clients>("clients");
