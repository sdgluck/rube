/**
 * What a queue row's State column says.
 *
 * An *Arr queue item carries two states. `trackedDownloadState` is the
 * *Arr's own import pipeline, and it reads "downloading" for the whole time
 * the file is with the download client — paused, queued behind others, or
 * stalled alike. `status` is what the download client itself reports. Showing
 * the first alone put "downloading" beside an item SABnzbd had paused, so while
 * the item is still with the client, the client's word wins.
 */
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
