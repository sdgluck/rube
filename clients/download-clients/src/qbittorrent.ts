/**
 * qBittorrent — Web API v2, cookie-session auth.
 *
 * The first stateful client in the repo: `POST /api/v2/auth/login` sets a `SID`
 * cookie that later calls must carry. The session is held in this closure and
 * renewed when a call comes back 403, so a client kept alive between polls
 * logs in once rather than every five seconds. With "bypass authentication for
 * localhost" on, the first call simply succeeds and no login happens at all.
 *
 * Web API 2.11 (qBittorrent 5) renamed pause/resume to stop/start, and the old
 * paths are gone rather than aliased — so the version is read once and the
 * path chosen from it.
 *
 * There is no global pause. qBittorrent's own "Pause All" pauses each torrent,
 * seeding ones included; that is what `pause()` does too, and the client
 * counts as paused when every torrent is.
 */
import type { DownloadClientItem, DownloadItemState } from "@tinkerbell/contracts";
import { createTransport, expectOk, fraction } from "./http.ts";
import {
  DownloadClientError,
  type DownloadClient,
  type DownloadClientConfig,
  type DownloadClientOptions,
} from "./types.ts";

interface QbitTorrent {
  hash: string;
  name?: string;
  state?: string;
  progress?: number;
  size?: number;
  amount_left?: number;
  dlspeed?: number;
}

const PAUSED_STATES = new Set(["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]);

function torrentState(state: string | undefined): DownloadItemState {
  switch (state) {
    case "downloading":
    case "forcedDL":
    case "metaDL":
    case "forcedMetaDL":
      return "downloading";
    case "stalledDL":
      return "stalled";
    case "queuedDL":
      return "queued";
    case "pausedDL":
    case "stoppedDL":
      return "paused";
    case "checkingDL":
    case "checkingUP":
    case "checkingResumeData":
    case "allocating":
    case "moving":
      return "checking";
    case "uploading":
    case "forcedUP":
    case "stalledUP":
    case "queuedUP":
      return "seeding";
    case "pausedUP":
    case "stoppedUP":
      return "completed";
    case "error":
    case "missingFiles":
      return "error";
    default:
      return "unknown";
  }
}

/** `2.11.2` ≥ `2.11` — compared numerically, not as strings. */
export function apiAtLeast(version: string, min: [number, number]): boolean {
  const [major = 0, minor = 0] = version.split(".").map((p) => Number.parseInt(p, 10));
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

export function createQbittorrentClient(
  config: DownloadClientConfig,
  opts: DownloadClientOptions = {},
): DownloadClient {
  const http = createTransport(config.url, opts);
  let cookie: string | null = null;
  let apiVersion: string | null = null;

  async function login(): Promise<void> {
    const res = await expectOk(
      await http.send("api/v2/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // qBittorrent's CSRF check compares Referer/Origin to its own host
          // when present; sending its own origin satisfies it.
          Referer: http.base.origin,
        },
        body: new URLSearchParams({ username: config.username ?? "", password: config.secret ?? "" }),
      }),
      "qBittorrent login",
    );
    const text = (await res.text()).trim();
    const sid = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .find((c) => c.startsWith("SID="));
    if (text !== "Ok." || !sid) throw new DownloadClientError("qBittorrent: rejected the credentials");
    cookie = sid;
  }

  async function call(path: string, form?: Record<string, string>): Promise<Response> {
    const attempt = () =>
      http.send(path, {
        method: form ? "POST" : "GET",
        headers: {
          Referer: http.base.origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
      });
    let res = await attempt();
    if (res.status === 403) {
      await res.body?.cancel();
      await login();
      res = await attempt();
    }
    return expectOk(res, "qBittorrent");
  }

  async function webApiVersion(): Promise<string> {
    apiVersion ??= (await (await call("api/v2/app/webapiVersion")).text()).trim();
    return apiVersion;
  }

  async function act(action: "pause" | "resume", hashes: string): Promise<void> {
    const modern = apiAtLeast(await webApiVersion(), [2, 11]);
    const verb = action === "pause" ? (modern ? "stop" : "pause") : modern ? "start" : "resume";
    await call(`api/v2/torrents/${verb}`, { hashes });
  }

  return {
    kind: "qbittorrent",

    async test() {
      return (await (await call("api/v2/app/version")).text()).trim();
    },

    async snapshot() {
      const torrents = (await (await call("api/v2/torrents/info")).json()) as QbitTorrent[];
      const version = await (async () => (await (await call("api/v2/app/version")).text()).trim())().catch(() => null);
      const items: DownloadClientItem[] = torrents.map((t) => ({
        id: t.hash,
        matchIds: [t.hash.toLowerCase()],
        name: t.name ?? t.hash,
        state: torrentState(t.state),
        paused: PAUSED_STATES.has(t.state ?? ""),
        progress: fraction(t.progress ?? null, 1),
        size: t.size ?? null,
        sizeLeft: t.amount_left ?? null,
        speed: t.dlspeed ?? null,
        message: null,
      }));
      return {
        status: {
          paused: items.length > 0 && items.every((i) => i.paused),
          speed: items.reduce((sum, i) => sum + (i.speed ?? 0), 0),
          version,
        },
        items,
      };
    },

    pause: () => act("pause", "all"),
    resume: () => act("resume", "all"),
    pauseItem: (id) => act("pause", id.toLowerCase()),
    resumeItem: (id) => act("resume", id.toLowerCase()),
  };
}
