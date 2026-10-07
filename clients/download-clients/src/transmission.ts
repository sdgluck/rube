/**
 * Transmission — RPC at `/transmission/rpc`, optional basic auth.
 *
 * Every session starts with a 409: Transmission's CSRF guard refuses the first
 * call and hands back an `X-Transmission-Session-Id` that every later call must
 * echo. The id is kept here and refreshed whenever a 409 says it has rotated.
 *
 * Like qBittorrent there is no global pause; `torrent-stop` with no ids stops
 * every torrent, which is what Transmission's own "pause all" does.
 */
import type { DownloadClientItem, DownloadItemState } from "@tinkerbell/contracts";
import { basicAuth, createTransport, expectOk, fraction } from "./http.ts";
import {
  DownloadClientError,
  type DownloadClient,
  type DownloadClientConfig,
  type DownloadClientOptions,
} from "./types.ts";

interface TransmissionTorrent {
  hashString: string;
  name?: string;
  status?: number;
  percentDone?: number;
  sizeWhenDone?: number;
  leftUntilDone?: number;
  rateDownload?: number;
  error?: number;
  errorString?: string;
}

const STOPPED = 0;

function torrentState(t: TransmissionTorrent): DownloadItemState {
  if (t.error) return "error";
  switch (t.status) {
    case STOPPED:
      return (t.percentDone ?? 0) >= 1 ? "completed" : "paused";
    case 1:
    case 2:
      return "checking";
    case 3:
      return "queued";
    case 4:
      return "downloading";
    case 5:
    case 6:
      return "seeding";
    default:
      return "unknown";
  }
}

/**
 * The RPC path. A URL that already names it is used as given; one ending in the
 * `/transmission` base gets `rpc`; a bare host gets the default path.
 */
export function rpcPath(base: URL): string {
  if (base.pathname.endsWith("/rpc/")) return "";
  if (base.pathname.endsWith("/transmission/")) return "rpc";
  return "transmission/rpc";
}

export function createTransmissionClient(
  config: DownloadClientConfig,
  opts: DownloadClientOptions = {},
): DownloadClient {
  const http = createTransport(config.url, opts);
  const path = rpcPath(http.base);
  let sessionId: string | null = null;

  async function rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const attempt = () =>
      http.send(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...basicAuth(config.username, config.secret),
          ...(sessionId ? { "X-Transmission-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify({ method, arguments: args }),
      });
    let res = await attempt();
    if (res.status === 409) {
      await res.body?.cancel();
      sessionId = res.headers.get("X-Transmission-Session-Id");
      if (!sessionId) throw new DownloadClientError("Transmission: 409 without a session id");
      res = await attempt();
    }
    const body = (await (await expectOk(res, "Transmission")).json()) as { result?: string; arguments?: T };
    if (body.result !== "success") throw new DownloadClientError(`Transmission ${method}: ${body.result ?? "failed"}`);
    return body.arguments as T;
  }

  async function version(): Promise<string> {
    return (await rpc<{ version: string }>("session-get", { fields: ["version"] })).version;
  }

  return {
    kind: "transmission",

    test: version,

    async snapshot() {
      const { torrents } = await rpc<{ torrents: TransmissionTorrent[] }>("torrent-get", {
        fields: [
          "hashString",
          "name",
          "status",
          "percentDone",
          "sizeWhenDone",
          "leftUntilDone",
          "rateDownload",
          "error",
          "errorString",
        ],
      });
      const items: DownloadClientItem[] = torrents.map((t) => ({
        id: t.hashString,
        matchIds: [t.hashString.toLowerCase()],
        name: t.name ?? t.hashString,
        state: torrentState(t),
        paused: t.status === STOPPED,
        progress: fraction(t.percentDone ?? null, 1),
        size: t.sizeWhenDone ?? null,
        sizeLeft: t.leftUntilDone ?? null,
        speed: t.rateDownload ?? null,
        message: t.error ? (t.errorString ?? null) : null,
      }));
      return {
        status: {
          paused: items.length > 0 && items.every((i) => i.paused),
          speed: items.reduce((sum, i) => sum + (i.speed ?? 0), 0),
          version: await version().catch(() => null),
        },
        items,
      };
    },

    async pause() {
      await rpc("torrent-stop");
    },
    async resume() {
      await rpc("torrent-start");
    },
    async pauseItem(id) {
      await rpc("torrent-stop", { ids: [id] });
    },
    async resumeItem(id) {
      await rpc("torrent-start", { ids: [id] });
    },
  };
}
