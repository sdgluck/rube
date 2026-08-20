/**
 * `POST /command` — the asynchronous half of every Servarr app.
 *
 * Searches, refreshes, rescans and renames all go through one endpoint that
 * answers immediately with a command id and does the work in the background.
 * The names differ per app (`MoviesSearch` vs `SeriesSearch`), so those live in
 * the app clients; the run-and-poll mechanism is identical and lives here.
 */

import type { ServarrHttp } from "./index.ts";

export interface ServarrCommand {
  id: number;
  name: string;
  /** queued | started | completed | failed | aborted */
  status: string;
  /** Present once the app has something to say — "Search for 3 movies". */
  message?: string;
  started?: string;
  ended?: string;
}

export interface AwaitCommandOptions {
  pollMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_AWAIT_TIMEOUT_MS = 120_000;
const TERMINAL = new Set(["completed", "failed", "aborted"]);

export function createCommands(http: ServarrHttp) {
  return {
    /** Start a command. Returns as soon as the app has accepted it. */
    run(name: string, body: Record<string, unknown> = {}): Promise<ServarrCommand> {
      return http.post<ServarrCommand>("/command", { name, ...body });
    },

    status(id: number): Promise<ServarrCommand> {
      return http.get<ServarrCommand>(`/command/${id}`);
    },

    list(): Promise<ServarrCommand[]> {
      return http.get<ServarrCommand[]>("/command");
    },

    cancel(id: number): Promise<void> {
      return http.del(`/command/${id}`);
    },

    /**
     * Poll until the command reaches a terminal state.
     *
     * Bounded by `timeoutMs`, and a timeout **does not cancel the command** —
     * it only stops us watching. A library refresh on a large instance can
     * outlive any deadline we would want to hold a request open for, and
     * aborting it because we got bored would be worse than losing sight of it.
     */
    async await(id: number, o: AwaitCommandOptions = {}): Promise<ServarrCommand> {
      const { pollMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_AWAIT_TIMEOUT_MS, signal } = o;
      const deadline = Date.now() + timeoutMs;
      let last = await this.status(id);
      while (!TERMINAL.has(last.status)) {
        if (Date.now() >= deadline) return last;
        await sleep(pollMs, signal);
        last = await this.status(id);
      }
      return last;
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
