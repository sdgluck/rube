/**
 * The download clients configured in `global_download_clients`: what they are
 * doing, and pausing or resuming them, whole or one item at a time.
 *
 * Proxied live, never mirrored — the same rule the *Arr queue follows, for the
 * same reason: a stored copy of a download queue looks authoritative and is
 * wrong within seconds.
 *
 * Client instances are kept between calls, keyed by their configuration.
 * qBittorrent and Deluge hold a login session, Transmission a CSRF session id,
 * and the Downloads page polls every five seconds — building a fresh client
 * per call would log in to each of them twelve times a minute. A changed entry
 * (new password, new URL) gets a fresh client, because the key changes with it.
 */
import { token } from "@tinkerbell/container";
import {
  DOWNLOAD_CLIENT_META,
  type DownloadClientKind,
  type DownloadClientOverview,
  type DownloadClientSummary,
} from "@tinkerbell/contracts";
import { errorMessage, REDACTED_SECRET, type ConfigStore, type ConfigValue } from "@tinkerbell/core";
import { createDownloadClient, type DownloadClient } from "@tinkerbell/download-clients";

type StoredClient = NonNullable<ConfigValue<"global_download_clients">>[number];

export interface DownloadClientTestInput {
  /** Present when testing a saved client, so a redacted secret can be filled back in. */
  id?: string;
  kind: DownloadClientKind;
  url: string;
  username?: string;
  secret?: string;
}

export class UnknownDownloadClientError extends Error {
  constructor(id: string) {
    super(`No download client "${id}" is configured`);
    this.name = "UnknownDownloadClientError";
  }
}

/**
 * Finished torrents are left out of the overview. A torrent client is also a
 * seeding box, often with thousands of finished torrents nobody asked about,
 * and shipping all of them to a page that polls every five seconds is the wrong
 * trade for rows that have nothing left to pause.
 */
const FINISHED = new Set(["seeding", "completed"]);

/** The label a client appears under in health checks: `SABnzbd (Main)`. */
export function downloadClientHealthName(client: { kind: DownloadClientKind; name: string }): string {
  return `${DOWNLOAD_CLIENT_META[client.kind].label} (${client.name})`;
}

export interface DownloadClientsDeps {
  config: ConfigStore;
}

export function createDownloadClients(deps: DownloadClientsDeps) {
  const { getConfig } = deps.config;
  const live = new Map<string, { key: string; client: DownloadClient }>();

  function configured(): StoredClient[] {
    return (getConfig("global_download_clients") ?? []).filter((c) => c.url);
  }

  function clientFor(stored: StoredClient): DownloadClient {
    const key = JSON.stringify([stored.kind, stored.url, stored.username, stored.secret]);
    const cached = live.get(stored.id);
    if (cached?.key === key) return cached.client;
    const client = createDownloadClient(stored);
    live.set(stored.id, { key, client });
    return client;
  }

  function clientById(id: string): DownloadClient {
    const stored = configured().find((c) => c.id === id);
    if (!stored) throw new UnknownDownloadClientError(id);
    return clientFor(stored);
  }

  /** Every configured client, without credentials. */
  function listDownloadClients(): DownloadClientSummary[] {
    return configured().map(({ id, name, kind }) => ({ id, name, kind }));
  }

  /**
   * Every client's state and in-flight items, side by side.
   *
   * One unreachable client is a row saying so, not a failed page: the point of
   * the overview is seeing the four that work while the fifth is down.
   */
  async function downloadClientsOverview(): Promise<DownloadClientOverview[]> {
    // Drop sessions for clients that have since been removed from config.
    const ids = new Set(configured().map((c) => c.id));
    for (const id of live.keys()) if (!ids.has(id)) live.delete(id);

    return Promise.all(
      configured().map(async (stored): Promise<DownloadClientOverview> => {
        const summary = { id: stored.id, name: stored.name, kind: stored.kind };
        try {
          const { status, items } = await clientFor(stored).snapshot();
          return { ...summary, ok: true, status, items: items.filter((i) => !FINISHED.has(i.state)) };
        } catch (err) {
          return { ...summary, ok: false, error: errorMessage(err) };
        }
      }),
    );
  }

  async function testDownloadClient(input: DownloadClientTestInput): Promise<string> {
    let secret = input.secret;
    if (secret === REDACTED_SECRET) {
      secret = configured().find((c) => c.id === input.id)?.secret;
    }
    // A fresh client, never the cached one: the test is of what is in the form.
    return createDownloadClient({ ...input, secret }).test();
  }

  return {
    listDownloadClients,
    downloadClientsOverview,
    testDownloadClient,
    pauseDownloadClient: async (id: string) => clientById(id).pause(),
    resumeDownloadClient: async (id: string) => clientById(id).resume(),
    pauseDownload: async (id: string, itemId: string) => clientById(id).pauseItem(itemId),
    resumeDownload: async (id: string, itemId: string) => clientById(id).resumeItem(itemId),
  };
}

export type DownloadClients = ReturnType<typeof createDownloadClients>;
export const DownloadClientsToken = token<DownloadClients>("downloadClients");
