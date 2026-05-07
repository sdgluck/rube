/**
 * Shared HTTP request helper for the `clients/*` packages. Wraps `fetch`
 * with timeout, retry, and error-body handling so each client doesn't
 * reinvent the same pattern (and forget to set a timeout, as several
 * had been doing).
 *
 * Lives in its own leaf package so any client can depend on it without
 * pulling in `@tinkerbell/core` (which itself depends on several clients,
 * which would otherwise be a cycle).
 *
 * Migration is incremental: callers that already have specialised
 * retry/timeout logic (e.g. clients/plex/src/http.ts) can keep their
 * wrappers and adopt this helper later.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;

export interface HttpRequestOptions {
  url: string | URL;
  init?: RequestInit;
  /** Per-call timeout. Stacks with any `init.signal` the caller passes. */
  timeoutMs?: number;
  /** Retries on network error or retryable status (default 0). */
  retries?: number;
  /** Override the default retryable status set (429/502/503/504). */
  retryOn?: ReadonlySet<number>;
  /** Truncate error response bodies to this many chars (default 200). */
  errorBodyMaxLen?: number;
}

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, statusText: string, body: string) {
    super(body ? `${status} ${statusText} — ${body}` : `${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), RETRY_MAX_DELAY_MS);
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

/**
 * Fire an HTTP request with timeout + optional retry. Returns the raw
 * `Response` for the caller to parse (so non-JSON callers like image
 * uploads can still use this).
 */
export async function httpRequest(opts: HttpRequestOptions): Promise<Response> {
  const {
    url,
    init = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    retryOn = DEFAULT_RETRYABLE_STATUS,
    errorBodyMaxLen = 200,
  } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (err) {
      if (attempt < retries) {
        await sleep(retryDelay(attempt), init.signal ?? undefined);
        continue;
      }
      throw err;
    }

    if (!res.ok && retryOn.has(res.status) && attempt < retries) {
      // Drain the body so the connection can be reused.
      await res.text().catch(() => "");
      await sleep(retryDelay(attempt), init.signal ?? undefined);
      continue;
    }

    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, errorBodyMaxLen);
      throw new HttpError(res.status, res.statusText, body);
    }

    return res;
  }

  // Unreachable — the loop either returns a response or throws.
  throw new Error("httpRequest: exhausted retries without a final response");
}

/** Convenience: `httpRequest` + `res.json()` with the same options. */
export async function httpRequestJson<T>(opts: HttpRequestOptions): Promise<T> {
  const res = await httpRequest(opts);
  return (await res.json()) as T;
}
