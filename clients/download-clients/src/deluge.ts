/**
 * Deluge — the Web UI's JSON-RPC at `/json`, cookie-session auth.
 *
 * Two layers to get through, not one. `auth.login` opens a web session (a
 * `_session_id` cookie); the web UI must then be *connected* to a daemon
 * before any `core.*` call means anything, and after a daemon restart it
 * isn't. So a call that fails "not authenticated" logs in again, and a session
 * with no daemon connects to the first host the web UI knows — which is the
 * only one in nearly every install.
 *
 * Deluge 2 split `pause_torrent(ids)` into `pause_torrent(id)` and
 * `pause_torrents(ids)`; 1.3 only has the list-taking `pause_torrent`. The
 * plural is tried first and the 1.3 spelling is the fallback.
 */
import type { DownloadClientItem, DownloadItemState } from "@rube/contracts";
import { createTransport, expectOk, fraction } from "./http.ts";
import {
  DownloadClientError,
  type DownloadClient,
  type DownloadClientConfig,
  type DownloadClientOptions,
} from "./types.ts";

interface DelugeTorrent {
  name?: string;
  state?: string;
  progress?: number;
  total_wanted?: number;
  total_done?: number;
  download_payload_rate?: number;
  message?: string;
}

const TORRENT_FIELDS = ["name", "state", "progress", "total_wanted", "total_done", "download_payload_rate", "message"];

/** Deluge's error code for an expired or missing web session. */
const NOT_AUTHENTICATED = 1;

class DelugeRpcError extends DownloadClientError {
  code: number | undefined;
  constructor(method: string, message: string, code: number | undefined) {
    super(`Deluge ${method}: ${message}`);
    this.code = code;
  }
}

function torrentState(t: DelugeTorrent): DownloadItemState {
  switch (t.state) {
    case "Downloading":
      return "downloading";
    case "Queued":
      return (t.progress ?? 0) >= 100 ? "seeding" : "queued";
    case "Paused":
      return (t.progress ?? 0) >= 100 ? "completed" : "paused";
    case "Seeding":
      return "seeding";
    case "Checking":
    case "Allocating":
    case "Moving":
      return "checking";
    case "Error":
      return "error";
    default:
      return "unknown";
  }
}

export function createDelugeClient(config: DownloadClientConfig, opts: DownloadClientOptions = {}): DownloadClient {
  const http = createTransport(config.url, opts);
  let cookie: string | null = null;
  let id = 0;

  async function raw<T>(method: string, params: unknown[]): Promise<T> {
    const res = await expectOk(
      await http.send("json", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({ method, params, id: ++id }),
      }),
      "Deluge",
    );
    const session = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .find((c) => c.startsWith("_session_id="));
    if (session) cookie = session;
    const body = (await res.json()) as { result?: T; error?: { message?: string; code?: number } | null };
    if (body.error) throw new DelugeRpcError(method, body.error.message ?? "failed", body.error.code);
    return body.result as T;
  }

  async function login(): Promise<void> {
    const ok = await raw<boolean>("auth.login", [config.secret ?? ""]);
    if (!ok) throw new DownloadClientError("Deluge: rejected the password");
  }

  async function ensureDaemon(): Promise<void> {
    if (await raw<boolean>("web.connected", [])) return;
    const hosts = await raw<Array<[string, ...unknown[]]>>("web.get_hosts", []);
    const first = hosts[0]?.[0];
    if (!first) throw new DownloadClientError("Deluge: the web UI has no daemon to connect to");
    await raw("web.connect", [first]);
  }

  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!cookie) {
      await login();
      await ensureDaemon();
    }
    try {
      return await raw<T>(method, params);
    } catch (err) {
      if (!(err instanceof DelugeRpcError) || err.code !== NOT_AUTHENTICATED) throw err;
      await login();
      await ensureDaemon();
      return raw<T>(method, params);
    }
  }

  async function eachTorrent(action: "pause" | "resume", ids: string[]): Promise<void> {
    try {
      await rpc(`core.${action}_torrents`, [ids]);
    } catch (err) {
      if (!(err instanceof DelugeRpcError) || !/unknown method/i.test(err.message)) throw err;
      await rpc(`core.${action}_torrent`, [ids]);
    }
  }

  return {
    kind: "deluge",

    async test() {
      return rpc<string>("daemon.info");
    },

    async snapshot() {
      const ui = await rpc<{ torrents: Record<string, DelugeTorrent> | null; stats?: { download_rate?: number } }>(
        "web.update_ui",
        [TORRENT_FIELDS, {}],
      );
      const paused = await rpc<boolean>("core.is_session_paused").catch(() => null);
      const items: DownloadClientItem[] = Object.entries(ui.torrents ?? {}).map(([hash, t]) => {
        const state = torrentState(t);
        const size = t.total_wanted ?? null;
        return {
          id: hash,
          matchIds: [hash.toLowerCase()],
          name: t.name ?? hash,
          state,
          paused: t.state === "Paused",
          progress: fraction(t.progress ?? null, 100),
          size,
          sizeLeft: size !== null && t.total_done !== undefined ? Math.max(0, size - t.total_done) : null,
          speed: t.download_payload_rate ?? null,
          message: state === "error" ? (t.message ?? null) : null,
        };
      });
      return {
        status: {
          // An old daemon without `is_session_paused` falls back to the torrent
          // clients' reading: paused when every torrent is.
          paused: paused ?? (items.length > 0 && items.every((i) => i.paused)),
          speed: ui.stats?.download_rate ?? null,
          version: await rpc<string>("daemon.info").catch(() => null),
        },
        items,
      };
    },

    async pause() {
      await rpc("core.pause_session");
    },
    async resume() {
      await rpc("core.resume_session");
    },
    pauseItem: (id) => eachTorrent("pause", [id]),
    resumeItem: (id) => eachTorrent("resume", [id]),
  };
}
