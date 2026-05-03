import type { PlexClientOptions, PlexHealthCallback, RequestOptions } from "./types.ts";

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;

function retryDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export interface PlexHttp {
  url: string;
  token: string;
  signal?: AbortSignal;
  onHealth?: PlexHealthCallback;
  request: (path: string, opts?: RequestOptions) => Promise<any>;
  requestRaw: (path: string, opts?: RequestOptions) => Promise<Response>;
}

export function createPlexHttp({ url, token, signal, onHealth }: PlexClientOptions): PlexHttp {
  async function request(path: string, { method = "GET", params = {}, headers = {} }: RequestOptions = {}) {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(reqUrl.toString(), {
          method,
          signal,
          headers: {
            Accept: "application/json",
            "X-Plex-Client-Identifier": "tinkerbell",
            "X-Plex-Product": "tinkerbell",
            "X-Plex-Version": "1.0.0",
            ...headers,
          },
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[plex] ${method} ${path} network error, retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await sleep(retryDelay(attempt));
          continue;
        }
        onHealth?.("Plex", "error", `${method} ${path} → ${errorMessage(err)}`);
        throw err;
      }

      if (!res.ok) {
        if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < MAX_RETRIES) {
          console.warn(`[plex] ${method} ${path} → ${res.status}, retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await sleep(retryDelay(attempt));
          continue;
        }
        const body = await res.text().catch(() => "");
        onHealth?.("Plex", "error", `${method} ${path} → ${res.status} ${res.statusText}`);
        throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
      }

      onHealth?.("Plex", "ok", `${method} ${path} → ${res.status}`);

      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
  }

  async function requestRaw(
    path: string,
    { method = "GET", params = {}, headers = {} }: RequestOptions = {},
  ): Promise<Response> {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    const res = await fetch(reqUrl.toString(), {
      method,
      signal,
      headers: {
        "X-Plex-Client-Identifier": "tinkerbell",
        "X-Plex-Product": "tinkerbell",
        "X-Plex-Version": "1.0.0",
        ...headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
    }

    return res;
  }

  return { url, token, signal, onHealth, request, requestRaw };
}
