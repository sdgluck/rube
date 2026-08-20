/**
 * The transport every TMDb call goes through: auth, the concurrency ceiling,
 * error translation, and the two date helpers.
 *
 * Extracted from `index.ts` when search arrived, so `search.ts` could reuse it
 * without either module importing the other's public surface. Nothing here is
 * exported from the package root except `TmdbConfig` and `TmdbError`.
 */

import PQueue from "p-queue";
import type { z } from "zod";
import { httpRequest, HttpError } from "@tinkerbell/http";

export const TMDB_BASE = "https://api.themoviedb.org/3";

/**
 * Ceiling on TMDb requests in flight, for the whole process.
 *
 * It lives here rather than at the call sites because the call sites multiply:
 * rules run concurrently, several of them fan out over people or franchises,
 * and each of those fans out again over credits. A per-caller limit is a
 * per-caller limit times however many callers there are, which is how you find
 * out what TMDb's rate limiter does. One queue at the only place every request
 * must pass through is the only bound that actually holds.
 */
const TMDB_CONCURRENCY = 8;
const tmdbQueue = new PQueue({ concurrency: TMDB_CONCURRENCY });

export interface TmdbConfig {
  apiKey: string;
  /**
   * Origin to talk to, for tests that stand a real HTTP server in for TMDb.
   * Production never sets it. A mock server catches URL-construction and
   * parameter-encoding bugs that a `fetch` stub agrees with you about.
   */
  baseUrl?: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────

/**
 * TMDb answers almost every auth failure with a bare 401 and puts the real
 * reason in a `status_code` in the body. A suspended key, a key TMDb has
 * never heard of, and an unverified email are three different problems with
 * three different fixes, and they arrive over the wire looking identical.
 * Collapsing them into "TMDb 401 Unauthorized" sent one debugging session
 * chasing an account ban that turned out to be a rotated key.
 */
export class TmdbError extends Error {
  /** HTTP status of the failing response. */
  readonly httpStatus: number;
  /** TMDb's own `status_code`, when the body carried one. */
  readonly statusCode?: number;
  constructor(message: string, httpStatus: number, statusCode?: number) {
    super(message);
    this.name = "TmdbError";
    this.httpStatus = httpStatus;
    this.statusCode = statusCode;
  }
}

/**
 * What an admin should actually *do* about each `status_code`, since TMDb's
 * own `status_message` says what happened but never what to change.
 */
const TMDB_STATUS_HINTS: Record<number, string> = {
  3: "authentication failed — the key is recognised but isn't permitted to use this endpoint.",
  7: "invalid API key — TMDb doesn't recognise it. Compare Settings → Databases → TMDb against themoviedb.org/settings/api; regenerating a key silently kills the old one.",
  10: "suspended API key — TMDb has suspended access for this account. A new key won't help; contact TMDb support.",
  25: "rate limited — too many requests in the window. This clears on its own.",
  32: "email not verified — confirm the email on the TMDb account before the key will work.",
  34: "the requested resource does not exist.",
};

function tmdbErrorFrom(err: HttpError, path: string): TmdbError {
  let statusCode: number | undefined;
  let statusMessage: string | undefined;
  try {
    const body: unknown = JSON.parse(err.body);
    if (body && typeof body === "object") {
      const { status_code, status_message } = body as Record<string, unknown>;
      if (typeof status_code === "number") statusCode = status_code;
      if (typeof status_message === "string") statusMessage = status_message;
    }
  } catch {
    // Non-JSON body — a proxy error page, or a payload truncated by
    // errorBodyMaxLen. Fall back to the raw HTTP status below.
  }
  const detail = (statusCode !== undefined ? TMDB_STATUS_HINTS[statusCode] : undefined) ?? statusMessage ?? err.message;
  const code = statusCode !== undefined ? ` (status_code ${statusCode})` : "";
  return new TmdbError(`TMDb ${path}: ${detail}${code}`, err.status, statusCode);
}

// ─── Core fetch helper ───────────────────────────────────────────────────

export async function tmdbFetch<S extends z.ZodTypeAny>(
  cfg: TmdbConfig,
  path: string,
  schema: S,
  params: Record<string, string> = {},
): Promise<z.infer<S>> {
  const url = new URL(`${cfg.baseUrl ?? TMDB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = (await tmdbQueue.add(() =>
      httpRequest({
        url,
        timeoutMs: 15_000,
        // Idempotent GET. A single 502 from TMDB at 01:00 used to fail the whole
        // nightly generate, with no job-level retry behind it.
        retries: 2,
        // TMDb error bodies are ~100 chars, but keep headroom so the JSON we
        // parse the status_code out of is never truncated mid-object.
        errorBodyMaxLen: 500,
        init: {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
          },
        },
      }),
    )) as Response;
  } catch (err) {
    if (err instanceof HttpError) throw tmdbErrorFrom(err, path);
    throw err;
  }
  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`TMDb ${path} response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function yearFromDate(d?: string): number | undefined {
  if (!d) return undefined;
  const m = d.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

export function monthFromDate(d?: string): number | undefined {
  if (!d) return undefined;
  const m = d.match(/^\d{4}-(\d{2})/);
  if (!m) return undefined;
  const month = parseInt(m[1], 10);
  return month >= 1 && month <= 12 ? month : undefined;
}
