/**
 * The little every client shares: a base URL that keeps its path, a deadline
 * on every request, and errors that say which host failed.
 *
 * Raw `fetch` rather than `@rube/http`, because two of these protocols
 * live in the failure responses that helper turns into exceptions:
 * Transmission's 409 carries the session id the retry needs, and qBittorrent's
 * 403 is the signal to log in again.
 */
import { DownloadClientError, type DownloadClientOptions } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface Transport {
  base: URL;
  send(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Ends in a slash, so `new URL("api", base)` lands under a URL base such as
 * `/sabnzbd/` instead of replacing it.
 */
export function baseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new DownloadClientError(`"${url}" is not a URL`);
  }
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

export function createTransport(url: string, opts: DownloadClientOptions = {}): Transport {
  const base = baseUrl(url);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(path.replace(/^\//, ""), base);
    try {
      return await fetch(target, {
        ...init,
        signal: opts.signal
          ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new DownloadClientError(`${base.host} didn't answer within ${Math.round(timeoutMs / 1000)}s`);
      }
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new DownloadClientError(
        `Couldn't reach ${base.host}: ${cause?.code ?? cause?.message ?? (err as Error).message}`,
      );
    }
  }

  return { base, send };
}

/** Throw a readable error for a non-2xx, naming what was being attempted. */
export async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  if (res.status === 401 || res.status === 403) {
    throw new DownloadClientError(`${what}: rejected the credentials (${res.status})`);
  }
  const body = (await res.text().catch(() => "")).trim().slice(0, 200);
  throw new DownloadClientError(`${what}: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
}

export function basicAuth(username: string | undefined, password: string | undefined): Record<string, string> {
  if (!username && !password) return {};
  return { Authorization: `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}` };
}

export function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 0–1, from whatever scale the client uses. */
export function fraction(value: number | null, scale: number): number | null {
  if (value === null) return null;
  return Math.min(1, Math.max(0, value / scale));
}
