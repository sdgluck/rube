import { httpRequest, HttpError } from "@tinkerbell/http";
import type { PlexClientOptions, PlexHealthCallback, RequestOptions } from "./types.ts";

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

const PLEX_HEADERS = {
  "X-Plex-Client-Identifier": "tinkerbell",
  "X-Plex-Product": "tinkerbell",
  "X-Plex-Version": "1.0.0",
};

export function createPlexHttp({ url, token, signal, onHealth }: PlexClientOptions): PlexHttp {
  function buildUrl(path: string, params: RequestOptions["params"]): URL {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }
    return reqUrl;
  }

  async function request(path: string, { method = "GET", params = {}, headers = {} }: RequestOptions = {}) {
    const reqUrl = buildUrl(path, params);
    let res: Response;
    try {
      res = await httpRequest({
        url: reqUrl,
        retries: 3,
        timeoutMs: 30_000,
        init: {
          method,
          signal,
          headers: { Accept: "application/json", ...PLEX_HEADERS, ...headers },
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        onHealth?.("Plex", "error", `${method} ${path} → ${err.status} ${err.message}`);
        throw new Error(`Plex API ${method} ${path} → ${err.message}`);
      }
      onHealth?.("Plex", "error", `${method} ${path} → ${errorMessage(err)}`);
      throw err;
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

  async function requestRaw(
    path: string,
    { method = "GET", params = {}, headers = {} }: RequestOptions = {},
  ): Promise<Response> {
    const reqUrl = buildUrl(path, params);
    try {
      return await httpRequest({
        url: reqUrl,
        retries: 3,
        timeoutMs: 30_000,
        init: {
          method,
          signal,
          headers: { ...PLEX_HEADERS, ...headers },
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw new Error(`Plex API ${method} ${path} → ${err.message}`);
      }
      throw err;
    }
  }

  return { url, token, signal, onHealth, request, requestRaw };
}
