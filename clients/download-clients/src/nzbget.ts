/**
 * NZBGet — JSON-RPC at `/jsonrpc`, HTTP basic auth.
 *
 * Sonarr and Radarr add every NZB with a `drone` post-processing parameter and
 * report *that* as the queue item's download id, not NZBGet's own `NZBID`. So
 * an item answers to both, or a row grabbed by an *Arr would never find its
 * NZBGet item.
 *
 * `editqueue` is the three-argument form (command, param, ids) that NZBGet has
 * taken since v16; the four-argument form before it is a decade old.
 */
import type { DownloadClientItem, DownloadItemState } from "@rube/contracts";
import { basicAuth, createTransport, expectOk, fraction } from "./http.ts";
import {
  DownloadClientError,
  type DownloadClient,
  type DownloadClientConfig,
  type DownloadClientOptions,
} from "./types.ts";

interface NzbgetGroup {
  NZBID: number;
  NZBName?: string;
  Status?: string;
  FileSizeLo?: number;
  FileSizeHi?: number;
  RemainingSizeLo?: number;
  RemainingSizeHi?: number;
  Parameters?: Array<{ Name: string; Value: string }>;
}

interface NzbgetStatus {
  DownloadPaused?: boolean;
  DownloadRate?: number;
}

function bytes(lo: number | undefined, hi: number | undefined): number | null {
  if (lo === undefined) return null;
  return (hi ?? 0) * 2 ** 32 + lo;
}

function groupState(status: string | undefined): DownloadItemState {
  switch (status) {
    case "DOWNLOADING":
      return "downloading";
    case "QUEUED":
    case "FETCHING":
      return "queued";
    case "PAUSED":
      return "paused";
    case "PP_QUEUED":
    case "LOADING_PARS":
    case "VERIFYING_SOURCES":
    case "REPAIRING":
    case "VERIFYING_REPAIRED":
    case "RENAMING":
    case "UNPACKING":
    case "MOVING":
    case "EXECUTING_SCRIPT":
      return "processing";
    case "PP_FINISHED":
      return "completed";
    default:
      return "unknown";
  }
}

export function createNzbgetClient(config: DownloadClientConfig, opts: DownloadClientOptions = {}): DownloadClient {
  const http = createTransport(config.url, opts);

  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await expectOk(
      await http.send("jsonrpc", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...basicAuth(config.username, config.secret) },
        body: JSON.stringify({ version: "1.1", method, params, id: 1 }),
      }),
      "NZBGet",
    );
    const body = (await res.json()) as { result?: T; error?: { message?: string } | null };
    if (body.error) throw new DownloadClientError(`NZBGet ${method}: ${body.error.message ?? "failed"}`);
    return body.result as T;
  }

  async function edit(command: "GroupPause" | "GroupResume", id: string): Promise<void> {
    const nzbId = Number(id);
    if (!Number.isInteger(nzbId)) throw new DownloadClientError(`NZBGet: "${id}" is not an NZB id`);
    const ok = await rpc<boolean>("editqueue", [command, "", [nzbId]]);
    if (!ok) throw new DownloadClientError(`NZBGet refused ${command} for ${id}`);
  }

  return {
    kind: "nzbget",

    async test() {
      return rpc<string>("version");
    },

    async snapshot() {
      const [status, groups, version] = await Promise.all([
        rpc<NzbgetStatus>("status"),
        rpc<NzbgetGroup[]>("listgroups", [0]),
        rpc<string>("version").catch(() => null),
      ]);
      const items: DownloadClientItem[] = groups.map((g) => {
        const size = bytes(g.FileSizeLo, g.FileSizeHi);
        const left = bytes(g.RemainingSizeLo, g.RemainingSizeHi);
        const drone = g.Parameters?.find((p) => p.Name === "drone")?.Value;
        const state = groupState(g.Status);
        return {
          id: String(g.NZBID),
          matchIds: [String(g.NZBID), ...(drone ? [drone.toLowerCase()] : [])],
          name: g.NZBName ?? String(g.NZBID),
          state,
          paused: state === "paused",
          progress: size && left !== null ? fraction(size - left, size) : null,
          size,
          sizeLeft: left,
          speed: null,
          message: null,
        };
      });
      return {
        status: { paused: status.DownloadPaused === true, speed: status.DownloadRate ?? null, version },
        items,
      };
    },

    async pause() {
      await rpc("pausedownload");
    },
    async resume() {
      await rpc("resumedownload");
    },
    pauseItem: (id) => edit("GroupPause", id),
    resumeItem: (id) => edit("GroupResume", id),
  };
}
