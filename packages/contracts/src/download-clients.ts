/**
 * Download clients — SABnzbd, NZBGet, qBittorrent, Transmission, Deluge.
 *
 * The vocabulary the server and the browser share. Five applications with five
 * APIs and five spellings of "paused" are reduced here to one state list, so
 * the Downloads page renders one table and never branches on which app a row
 * came from.
 *
 * Rube holds its own connection to each client rather than borrowing the
 * one Radarr and Sonarr have: the *Arrs mask every password and API key in
 * `GET /downloadclient`, so there is nothing usable to borrow.
 */

export const DOWNLOAD_CLIENT_KINDS = ["sabnzbd", "nzbget", "qbittorrent", "transmission", "deluge"] as const;
export type DownloadClientKind = (typeof DOWNLOAD_CLIENT_KINDS)[number];

export interface DownloadClientMeta {
  label: string;
  protocol: "usenet" | "torrent";
  urlPlaceholder: string;
  /** Whether the form asks for a username at all, and whether it may be blank. */
  username: "none" | "optional" | "required";
  /** What the one secret is called in that app's own settings. */
  secretLabel: "API key" | "Password";
  /** Transmission runs without auth by default; everything else needs the secret. */
  secretRequired: boolean;
  /**
   * Whether pausing the client is a state of its own, or "every torrent is
   * paused". qBittorrent and Transmission have no global switch — their own
   * Pause All pauses each torrent, seeding ones included — so the Downloads
   * page says so before somebody stops their seeding by accident.
   */
  globalPause: "native" | "every-item";
}

export const DOWNLOAD_CLIENT_META: Record<DownloadClientKind, DownloadClientMeta> = {
  sabnzbd: {
    label: "SABnzbd",
    protocol: "usenet",
    urlPlaceholder: "http://localhost:8080",
    username: "none",
    secretLabel: "API key",
    secretRequired: true,
    globalPause: "native",
  },
  nzbget: {
    label: "NZBGet",
    protocol: "usenet",
    urlPlaceholder: "http://localhost:6789",
    username: "required",
    secretLabel: "Password",
    secretRequired: true,
    globalPause: "native",
  },
  qbittorrent: {
    label: "qBittorrent",
    protocol: "torrent",
    urlPlaceholder: "http://localhost:8080",
    username: "optional",
    secretLabel: "Password",
    secretRequired: false,
    globalPause: "every-item",
  },
  transmission: {
    label: "Transmission",
    protocol: "torrent",
    urlPlaceholder: "http://localhost:9091",
    username: "optional",
    secretLabel: "Password",
    secretRequired: false,
    globalPause: "every-item",
  },
  deluge: {
    label: "Deluge",
    protocol: "torrent",
    urlPlaceholder: "http://localhost:8112",
    username: "none",
    secretLabel: "Password",
    secretRequired: true,
    globalPause: "native",
  },
};

/**
 * One item's state, in words that mean the same thing for every client.
 *
 * `stalled` is a torrent with no peers sending; `seeding` is complete and
 * uploading; `completed` is finished and idle (post-processing, for usenet).
 */
export const DOWNLOAD_ITEM_STATES = [
  "downloading",
  "queued",
  "paused",
  "stalled",
  "checking",
  "processing",
  "seeding",
  "completed",
  "error",
  "unknown",
] as const;
export type DownloadItemState = (typeof DOWNLOAD_ITEM_STATES)[number];

export interface DownloadClientItem {
  /** The client's own handle, which item actions are addressed to. */
  id: string;
  /**
   * Every id an *Arr may know this item by, lower-cased. Usually just `id`, but
   * NZBGet items added by Sonarr or Radarr carry a `drone` parameter that the
   * *Arr reports instead of the NZB id, and torrent hashes are written
   * upper-case by the *Arrs and lower-case by the clients.
   */
  matchIds: string[];
  name: string;
  state: DownloadItemState;
  /** Whether a resume (rather than a pause) is the action this item offers. */
  paused: boolean;
  /** 0–1, or null when the client doesn't say. */
  progress: number | null;
  /** Bytes. */
  size: number | null;
  sizeLeft: number | null;
  /** Bytes per second. */
  speed: number | null;
  /** Free text from the client when the state is `error`. */
  message: string | null;
}

export interface DownloadClientStatus {
  /** The whole client is paused: natively, or (torrents) every item is. */
  paused: boolean;
  /** Bytes per second across the client. */
  speed: number | null;
  version: string | null;
}

/** One configured client, as the browser may see it — no credentials. */
export interface DownloadClientSummary {
  id: string;
  name: string;
  kind: DownloadClientKind;
}

export type DownloadClientOverview = DownloadClientSummary &
  ({ ok: true; status: DownloadClientStatus; items: DownloadClientItem[] } | { ok: false; error: string });

/**
 * Lower-cased, because the *Arrs write torrent hashes upper-case and the
 * clients report them lower-case — `arr_activity.download_id` learned this
 * first.
 */
export function normaliseDownloadId(id: string): string {
  return id.trim().toLowerCase();
}
