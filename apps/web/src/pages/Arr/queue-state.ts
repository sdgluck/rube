/**
 * What a queue row's State column says.
 *
 * An *Arr queue item carries two states. `trackedDownloadState` is the
 * *Arr's own import pipeline, and it reads "downloading" for the whole time
 * the file is with the download client — paused, queued behind others, or
 * stalled alike. `status` is what the download client itself reports. Showing
 * the first alone put "downloading" beside an item SABnzbd had paused, so while
 * the item is still with the client, the client's word wins.
 *
 * Better still is asking the client directly. Where a download client is
 * configured in Rube, the row is joined to the client's own item by
 * download id, and that item's state — fresher than the *Arr's, which polls
 * its clients on its own schedule — is what the row shows.
 */
import {
  normaliseDownloadId,
  type DownloadClientItem,
  type DownloadClientOverview,
  type DownloadItemState,
} from "@rube/contracts";
import type { StatusChipTone } from "#components/PageShell";

export interface QueueStateInput {
  status?: string;
  trackedDownloadState?: string;
}

export interface QueueState {
  label: string;
  /** Unset for the ordinary case, which renders as muted text rather than a chip. */
  tone?: StatusChipTone;
}

/** The download client's `status`, as Radarr and Sonarr both spell it. */
const CLIENT_STATES: Record<string, QueueState> = {
  downloading: { label: "downloading" },
  queued: { label: "queued" },
  paused: { label: "paused", tone: "advisory" },
  delay: { label: "delayed", tone: "advisory" },
  warning: { label: "warning", tone: "advisory" },
  fallback: { label: "fallback", tone: "advisory" },
  downloadClientUnavailable: { label: "client unavailable", tone: "error" },
  failed: { label: "failed", tone: "error" },
  completed: { label: "completed" },
};

export function queueState(item: QueueStateInput): QueueState {
  const tracked = item.trackedDownloadState;
  // Past the client (importing, imported, failed import), the pipeline state is the news.
  if (tracked && tracked !== "downloading") return { label: tracked };
  const client = item.status ? CLIENT_STATES[item.status] : undefined;
  return client ?? { label: item.status || tracked || "—" };
}

/** The client item a queue row is, and the client it lives in. */
export interface ClientMatch {
  clientId: string;
  clientName: string;
  item: DownloadClientItem;
}

/** Every reachable client's items, by each id an *Arr might know them by. */
export function indexClientItems(overview: DownloadClientOverview[]): Map<string, ClientMatch> {
  const out = new Map<string, ClientMatch>();
  for (const client of overview) {
    if (!client.ok) continue;
    for (const item of client.items) {
      for (const id of item.matchIds) out.set(id, { clientId: client.id, clientName: client.name, item });
    }
  }
  return out;
}

export function findClientItem(index: Map<string, ClientMatch>, downloadId: string | undefined): ClientMatch | null {
  return downloadId ? (index.get(normaliseDownloadId(downloadId)) ?? null) : null;
}

const ITEM_TONES: Partial<Record<DownloadItemState, StatusChipTone>> = {
  paused: "advisory",
  stalled: "advisory",
  error: "error",
};

/** A client item's state, as the State column shows it. */
export function clientItemState(item: DownloadClientItem): QueueState {
  const label = item.state === "error" && item.message ? item.message : item.state;
  const tone = ITEM_TONES[item.state];
  return tone ? { label, tone } : { label };
}
