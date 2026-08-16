import { XMLParser } from "fast-xml-parser";
import { httpRequest, HttpError } from "@tinkerbell/http";
import { PlexApiError } from "./http.ts";
import type { PlexHttp } from "./http.ts";
import type { PlexTvRequestOptions } from "./types.ts";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * Containers we walk return as arrays even when there's only one child, so
 * downstream code doesn't have to special-case 1-vs-N.
 */
const ARRAY_NODES = new Set(["User", "Server", "SharedServer", "Section", "Directory"]);

export const plexTvXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) => ARRAY_NODES.has(name),
});

export function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * plex.tv (the account service), as opposed to the media server `PlexHttp`
 * talks to. Same token, entirely different API: half of it answers in XML
 * regardless of `Accept`, so the caller gets `{ _raw }` when the body isn't
 * JSON and parses it with `plexTvXmlParser`.
 *
 * Errors surface as `PlexApiError` so callers can branch on the status —
 * plex.tv leans on it for meaning (422 is "already shared", 429 is a rate
 * limit), which is unrecoverable once it has been flattened into a message.
 */
export type PlexTvRequest = (path: string, opts?: PlexTvRequestOptions) => Promise<any>;

export function createPlexTvRequest(http: PlexHttp): PlexTvRequest {
  const base = http.plexTvUrl ?? "https://plex.tv";

  return async function plexTvRequest(
    path: string,
    { method = "GET", params = {}, headers = {}, body }: PlexTvRequestOptions = {},
  ) {
    const reqUrl = new URL(path, base);
    reqUrl.searchParams.set("X-Plex-Token", http.token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    const isJsonBody = body !== undefined && typeof body !== "string";
    const payload = body === undefined ? undefined : isJsonBody ? JSON.stringify(body) : body;

    let res: Response;
    try {
      res = await httpRequest({
        url: reqUrl,
        retries: 3,
        timeoutMs: 15_000,
        init: {
          method,
          body: payload,
          signal: http.signal,
          headers: {
            Accept: "application/json",
            "X-Plex-Client-Identifier": "tinkerbell",
            "X-Plex-Product": "tinkerbell",
            "X-Plex-Version": "1.0.0",
            ...(payload === undefined ? {} : { "Content-Type": isJsonBody ? "application/json" : "application/xml" }),
            ...headers,
          },
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        http.onHealth?.("Plex.tv", "error", `${method} ${path} → ${err.status}`);
        throw new PlexApiError(err.status, method, path, err.message);
      }
      http.onHealth?.("Plex.tv", "error", `${method} ${path} → ${errorMessage(err)}`);
      throw err;
    }

    http.onHealth?.("Plex.tv", "ok", `${method} ${path} → ${res.status}`);

    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  };
}
