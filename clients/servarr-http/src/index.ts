/**
 * The transport every Servarr app shares.
 *
 * Radarr, Sonarr and Prowlarr are the same web application wearing different
 * metadata: same `X-Api-Key` header, same `/api/vN/` prefix, same command
 * endpoint, same `fields[]` shape for provider settings, same validation error
 * body. Three copies of that would be three places to get the retry policy
 * wrong.
 *
 * This is deliberately **not** a base client. It knows nothing about movies,
 * series or indexers, and the per-app clients do not extend it — they hold one
 * and call it. Where the apps genuinely diverge (and they diverge a lot: see
 * the monitoring model, the quality vocabulary, the entity depth) the
 * divergence lives in the app's own client, in the open, rather than in an
 * `if (service === …)` buried in a shared method.
 */

import { httpRequest, HttpError } from "@rube/http";

/** How long a normal call may take. Long-running reads override per call. */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ServarrHttpOptions {
  /** Base URL of the instance, e.g. `http://localhost:7878`. */
  baseUrl: string;
  apiKey: string;
  /**
   * The API version segment — `v3` for Radarr/Sonarr, `v1` for Prowlarr.
   *
   * A parameter rather than a hardcoded `/api/v3/` because retrofitting it
   * later means touching every call site in every client, and it costs nothing
   * to take it now.
   */
  apiVersion?: string;
  /** Cancels in-flight work when the job that owns this client is stopped. */
  signal?: AbortSignal;
  /** Reports reachability to the health system, as the Plex client does. */
  onHealth?: (ok: boolean, error?: string) => void;
  defaultTimeoutMs?: number;
}

export interface ServarrRequestOptions {
  /** Query parameters. Undefined and null values are dropped. */
  params?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
  /** Retries. Only ever set for reads — see `ServarrHttp.get`. */
  retries?: number;
}

/** A response the caller wants to inspect rather than have thrown at it. */
export interface RawResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * A Servarr validation failure, with the field-level detail parsed out.
 *
 * The apps answer a bad POST/PUT with `[{propertyName, errorMessage}]`, which
 * is far more useful than the status alone — it is the difference between
 * "400 Bad Request" and "rootFolderPath: Path does not exist".
 */
export class ServarrError extends Error {
  readonly status: number;
  readonly body: string;
  readonly failures: ReadonlyArray<{ field: string; message: string }>;

  constructor(service: string, status: number, body: string, message?: string) {
    const failures = parseFailures(body);
    const detail = failures.length > 0 ? failures.map((f) => `${f.field}: ${f.message}`).join("; ") : message;
    super(detail ? `${service}: ${detail}` : `${service}: ${status}`);
    this.name = "ServarrError";
    this.status = status;
    this.body = body;
    this.failures = failures;
  }
}

function parseFailures(body: string): Array<{ field: string; message: string }> {
  if (!body) return [];
  try {
    const parsed: unknown = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const out: Array<{ field: string; message: string }> = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const message = r.errorMessage ?? r.message;
      if (typeof message !== "string") continue;
      out.push({ field: typeof r.propertyName === "string" ? r.propertyName : "", message });
    }
    return out;
  } catch {
    // A non-JSON body (an HTML error page from a reverse proxy, most often) is
    // not a validation failure and must not be reported as one.
    return [];
  }
}

function buildUrl(baseUrl: string, apiVersion: string, path: string, params?: ServarrRequestOptions["params"]): URL {
  // `path` is given without the prefix ("/movie"), so the caller never repeats
  // the version and no call site can disagree with another about it.
  const url = new URL(`/api/${apiVersion}${path.startsWith("/") ? path : `/${path}`}`, baseUrl);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

export function createServarrHttp(opts: ServarrHttpOptions) {
  const { baseUrl, apiKey, apiVersion = "v3", signal, onHealth, defaultTimeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const service = new URL(baseUrl).host;

  async function send(method: string, path: string, body: unknown, o: ServarrRequestOptions = {}): Promise<Response> {
    const url = buildUrl(baseUrl, apiVersion, path, o.params);
    try {
      const res = await httpRequest({
        url,
        timeoutMs: o.timeoutMs ?? defaultTimeoutMs,
        retries: o.retries ?? 0,
        init: {
          method,
          signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      });
      onHealth?.(true);
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        // A 4xx means we reached the app and it disagreed with us — that is a
        // healthy instance answering, not an unreachable one. Only transport
        // failures and 5xx say anything about reachability.
        if (err.status >= 500) onHealth?.(false, err.message);
        throw new ServarrError(service, err.status, err.body, err.message);
      }
      onHealth?.(false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Parse a response body, tolerating the empty one.
   *
   * A DELETE or PUT can legitimately answer 200 with no body, and both *Arrs
   * do in some versions. Parsing that as JSON throws *after* the mutation has
   * already happened — which for a delete means the file is gone, the caller
   * sees a failure, and the item is retried forever.
   */
  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return null as T;
    const text = await res.text();
    if (!text) return null as T;
    return JSON.parse(text) as T;
  }

  return {
    /**
     * A read. Retried twice by default: reads are idempotent, and a *Arr behind
     * a reverse proxy that is restarting is the common case.
     */
    async get<T>(path: string, o: ServarrRequestOptions = {}): Promise<T> {
      return parse<T>(await send("GET", path, undefined, { retries: 2, ...o }));
    },

    /**
     * A mutation. **Never retried**, and there is no option to.
     *
     * A POST that succeeded but whose response was lost would, on retry, add
     * the record twice or duplicate an import-list exclusion — a silent "this
     * will never come back" that nobody goes looking for. One failure that
     * gets retried by the next scheduled run is strictly better.
     */
    async post<T>(path: string, body?: unknown, o: ServarrRequestOptions = {}): Promise<T> {
      return parse<T>(await send("POST", path, body, { ...o, retries: 0 }));
    },

    async put<T>(path: string, body?: unknown, o: ServarrRequestOptions = {}): Promise<T> {
      return parse<T>(await send("PUT", path, body, { ...o, retries: 0 }));
    },

    /**
     * A delete. Takes an optional body, because the `/editor` bulk endpoints
     * are `DELETE` with a JSON payload naming the records and the flags.
     */
    async del<T>(path: string, o: ServarrRequestOptions & { body?: unknown } = {}): Promise<T> {
      const { body, ...rest } = o;
      return parse<T>(await send("DELETE", path, body, { ...rest, retries: 0 }));
    },

    /**
     * A mutation whose non-2xx answer is expected and meaningful.
     *
     * The one caller that needs this is "add", where a 400 saying the record
     * already exists is a normal outcome rather than a failure. Before this
     * existed that call reached for bare `fetch`, which meant a second
     * transport with its own timeout and no `Retry-After` handling. One code
     * path is worth the extra verb.
     */
    async raw(method: string, path: string, body?: unknown, o: ServarrRequestOptions = {}): Promise<RawResult> {
      try {
        const res = await send(method, path, body, { ...o, retries: 0 });
        return { ok: true, status: res.status, body: await res.text() };
      } catch (err) {
        if (err instanceof ServarrError) return { ok: false, status: err.status, body: err.body };
        throw err;
      }
    },
  };
}

export type ServarrHttp = ReturnType<typeof createServarrHttp>;

export { createCommands, type ServarrCommand, type AwaitCommandOptions } from "./command.ts";
export {
  isSecretField,
  redactProviderSecrets,
  mergeFieldValues,
  secretFieldNames,
  type ServarrField,
  type ServarrProvider,
} from "./fields.ts";
export { parseExternalId, formatExternalId, type ExternalId, type ExternalScheme } from "./external-id.ts";
