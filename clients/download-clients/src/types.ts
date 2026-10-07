import type { DownloadClientItem, DownloadClientKind, DownloadClientStatus } from "@tinkerbell/contracts";

export interface DownloadClientConfig {
  kind: DownloadClientKind;
  /** Base URL, including any URL base the app is served under. */
  url: string;
  username?: string;
  /** SABnzbd's API key, or the password for everything else. */
  secret?: string;
}

export interface DownloadClientOptions {
  /** Cancels in-flight work when the caller gives up. */
  signal?: AbortSignal;
  /** Per request. The Downloads page polls, so a hung client must fail fast. */
  timeoutMs?: number;
}

export interface DownloadClientSnapshot {
  status: DownloadClientStatus;
  items: DownloadClientItem[];
}

/**
 * The five clients behind one shape.
 *
 * `snapshot` rather than separate status and item reads because, for the
 * torrent clients, "is the client paused" *is* a fact about the items — and
 * one request is one request less on a page that polls every five seconds.
 */
export interface DownloadClient {
  readonly kind: DownloadClientKind;
  /** Proves the address and credentials both work, and returns the app's version. */
  test(): Promise<string>;
  snapshot(): Promise<DownloadClientSnapshot>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  pauseItem(id: string): Promise<void>;
  resumeItem(id: string): Promise<void>;
}

/** A failure worth showing the user verbatim: bad credentials, an unreachable host, a refused call. */
export class DownloadClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadClientError";
  }
}
