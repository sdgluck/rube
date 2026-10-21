import { httpRequest, HttpError } from "@rube/http";
import type { PlexClientOptions, PlexHealthCallback, RequestOptions } from "./types.ts";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * A failed Plex call, with the HTTP status kept as a field rather than only
 * baked into the message. Callers need to branch on it — a 403 from Plex means
 * something a user can go and fix, and telling them that requires knowing it
 * was a 403 without regex-ing the message back apart.
 */
export class PlexApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  constructor(status: number, method: string, path: string, detail: string) {
    super(`Plex API ${method} ${path} → ${detail}`);
    this.name = "PlexApiError";
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

export interface PlexHttp {
  url: string;
  token: string;
  /** Base for the account service. See `PlexClientOptions.plexTvUrl`. */
  plexTvUrl?: string;
  signal?: AbortSignal;
  onHealth?: PlexHealthCallback;
  request: (path: string, opts?: RequestOptions) => Promise<any>;
  requestRaw: (path: string, opts?: RequestOptions) => Promise<Response>;
}

const PLEX_HEADERS = {
  "X-Plex-Client-Identifier": "rube",
  "X-Plex-Product": "rube",
  "X-Plex-Version": "1.0.0",
};

export function createPlexHttp({ url, token, signal, onHealth, plexTvUrl }: PlexClientOptions): PlexHttp {
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
        throw new PlexApiError(err.status, method, path, err.message);
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
      // Some Plex endpoints return XML even when we ask for JSON
      // (e.g. legacy /sharing); callers tolerate `null` by treating it as
      // "no parsed payload" and falling back to status-only behaviour.
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
        throw new PlexApiError(err.status, method, path, err.message);
      }
      throw err;
    }
  }

  return { url, token, plexTvUrl, signal, onHealth, request, requestRaw };
}
