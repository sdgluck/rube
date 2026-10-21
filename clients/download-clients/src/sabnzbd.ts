/**
 * SABnzbd — `GET /api?mode=…&apikey=…&output=json`.
 *
 * A wrong API key is not an HTTP error: SABnzbd answers 200 with
 * `{ status: false, error: "API Key Incorrect" }`, so every response is
 * checked for that body or a bad key would read as an empty, healthy queue.
 */
import type { DownloadClientItem, DownloadItemState } from "@rube/contracts";
import { createTransport, expectOk, num, fraction } from "./http.ts";
import {
  DownloadClientError,
  type DownloadClient,
  type DownloadClientConfig,
  type DownloadClientOptions,
} from "./types.ts";

interface SabSlot {
  nzo_id: string;
  filename?: string;
  status?: string;
  mb?: string;
  mbleft?: string;
  percentage?: string;
}

interface SabQueue {
  paused?: boolean;
  kbpersec?: string;
  version?: string;
  slots?: SabSlot[];
}

const MB = 1024 * 1024;

/** SABnzbd's slot statuses. Anything post-download is `processing`. */
function slotState(status: string | undefined): DownloadItemState {
  switch (status) {
    case "Downloading":
      return "downloading";
    case "Queued":
    case "Grabbing":
    case "Fetching":
    case "Propagating":
      return "queued";
    case "Paused":
      return "paused";
    case "Checking":
    case "QuickCheck":
    case "Verifying":
    case "Repairing":
    case "Extracting":
    case "Moving":
    case "Running":
      return "processing";
    case "Failed":
      return "error";
    case "Completed":
      return "completed";
    default:
      return "unknown";
  }
}

export function createSabnzbdClient(config: DownloadClientConfig, opts: DownloadClientOptions = {}): DownloadClient {
  const http = createTransport(config.url, opts);

  async function api<T>(params: Record<string, string>): Promise<T> {
    const search = new URLSearchParams({ ...params, apikey: config.secret ?? "", output: "json" });
    const res = await expectOk(await http.send(`api?${search}`), "SABnzbd");
    const body = (await res.json()) as T & { status?: boolean; error?: string };
    if (body && typeof body === "object" && body.status === false) {
      throw new DownloadClientError(`SABnzbd: ${body.error ?? "refused the request"}`);
    }
    return body;
  }

  async function queue(): Promise<SabQueue> {
    return (await api<{ queue: SabQueue }>({ mode: "queue" })).queue ?? {};
  }

  return {
    kind: "sabnzbd",

    async test() {
      // `mode=version` answers without a key, so it can't be the whole test.
      const q = await api<{ queue: SabQueue }>({ mode: "queue", limit: "0" });
      return q.queue?.version ?? (await api<{ version: string }>({ mode: "version" })).version;
    },

    async snapshot() {
      const q = await queue();
      const items: DownloadClientItem[] = (q.slots ?? []).map((slot) => {
        const size = num(slot.mb);
        const left = num(slot.mbleft);
        const state = slotState(slot.status);
        return {
          id: slot.nzo_id,
          matchIds: [slot.nzo_id.toLowerCase()],
          name: slot.filename ?? slot.nzo_id,
          state,
          paused: state === "paused",
          progress: fraction(num(slot.percentage), 100),
          size: size === null ? null : size * MB,
          sizeLeft: left === null ? null : left * MB,
          speed: null,
          message: null,
        };
      });
      const kbps = num(q.kbpersec);
      return {
        status: { paused: q.paused === true, speed: kbps === null ? null : kbps * 1024, version: q.version ?? null },
        items,
      };
    },

    async pause() {
      await api({ mode: "pause" });
    },
    async resume() {
      await api({ mode: "resume" });
    },
    async pauseItem(id) {
      await api({ mode: "queue", name: "pause", value: id });
    },
    async resumeItem(id) {
      await api({ mode: "queue", name: "resume", value: id });
    },
  };
}
