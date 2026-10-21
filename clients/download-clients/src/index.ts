/**
 * SABnzbd, NZBGet, qBittorrent, Transmission and Deluge behind one interface.
 *
 * Five separate implementations rather than a base class, for the reason
 * `clients/servarr-http` gives: they share almost nothing on the wire — query
 * string, JSON-RPC with basic auth, form posts with a cookie, a CSRF
 * handshake, JSON-RPC with a cookie *and* a daemon connection — and the
 * differences are the whole job. What they share is the shape of the answer,
 * which is declared once in `@rube/contracts`.
 */
import { DOWNLOAD_CLIENT_META, type DownloadClientItem } from "@rube/contracts";
import { createDelugeClient } from "./deluge.ts";
import { createNzbgetClient } from "./nzbget.ts";
import { createQbittorrentClient } from "./qbittorrent.ts";
import { createSabnzbdClient } from "./sabnzbd.ts";
import { createTransmissionClient } from "./transmission.ts";
import type { DownloadClient, DownloadClientConfig, DownloadClientOptions, DownloadClientSnapshot } from "./types.ts";

export * from "./types.ts";

const FACTORIES = {
  sabnzbd: createSabnzbdClient,
  nzbget: createNzbgetClient,
  qbittorrent: createQbittorrentClient,
  transmission: createTransmissionClient,
  deluge: createDelugeClient,
} satisfies Record<
  DownloadClientConfig["kind"],
  (c: DownloadClientConfig, o?: DownloadClientOptions) => DownloadClient
>;

/**
 * While a client with a real pause switch is paused, nothing in it is
 * downloading — but SABnzbd and Deluge go on reporting their items as
 * "Downloading" or "Queued". Those read as paused here. The item's own
 * `paused` flag is left alone: it says whether *this item* has been paused,
 * which is what its resume button acts on.
 */
function withClientPause(snapshot: DownloadClientSnapshot, native: boolean): DownloadClientSnapshot {
  if (!native || !snapshot.status.paused) return snapshot;
  const idle = new Set<DownloadClientItem["state"]>(["downloading", "queued", "stalled"]);
  return {
    ...snapshot,
    items: snapshot.items.map((i) => (idle.has(i.state) ? { ...i, state: "paused", speed: 0 } : i)),
  };
}

export function createDownloadClient(config: DownloadClientConfig, opts: DownloadClientOptions = {}): DownloadClient {
  const client = FACTORIES[config.kind](config, opts);
  const native = DOWNLOAD_CLIENT_META[config.kind].globalPause === "native";
  return { ...client, snapshot: async () => withClientPause(await client.snapshot(), native) };
}

export { apiAtLeast } from "./qbittorrent.ts";
export { rpcPath } from "./transmission.ts";
