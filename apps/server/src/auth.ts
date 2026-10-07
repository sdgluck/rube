/**
 * The admin gate for the routes that bypass tRPC.
 *
 * `/api/plex-image` and `/api/prerolls/…` are plain Node handlers, so the
 * tRPC middleware never sees them — without this they'd stay open even with
 * auth on, and `/api/plex-image` in particular is an image proxy that uses
 * the server's own Plex token.
 *
 * The cookie parsing lives in `security.ts` (pure, unit-tested); this module
 * is the thin glue that reaches into core for the session lookup, which is
 * why it isn't in `security.ts` itself — that file must stay importable
 * without opening the database.
 *
 * Three credentials get through, for three kinds of caller:
 *
 * - the `tb_admin_session` cookie — the browser SPA, served from this origin;
 * - `Authorization: Bearer <session>` — the native app's uploads and fetches,
 *   which reach this server cross-origin where no cookie is sent;
 * - `?access_token=<media token>` on GET/HEAD only — the native app's `<img>`
 *   and `<video>` tags, which can't send a header at all. That token is its own
 *   short-lived `admin-media` session, so the real one never sits in a URL, and
 *   it can't upload, import or post a poster because those are all POSTs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Services } from "@tinkerbell/composition";
import { parseBearerToken } from "@tinkerbell/core";
import { parseCookieHeader } from "./security.ts";

const ADMIN_COOKIE = "tb_admin_session";

export function createAuth(deps: Services) {
  const { adminAuthRequired, isAdminAccount } = deps.adminAuth;
  const { getPlexSession } = deps.sessions;

  /** True when the request may proceed: auth is off, or it carries an admin session. */
  function isAdminRequest(req: IncomingMessage): boolean {
    if (!adminAuthRequired()) return true;
    const raw =
      parseCookieHeader(req.headers.cookie ?? "", ADMIN_COOKIE) ?? parseBearerToken(req.headers.authorization);
    const session = getPlexSession(raw, "admin") ?? mediaSession(req);
    return !!session && isAdminAccount(session.userId);
  }

  function mediaSession(req: IncomingMessage) {
    if (req.method !== "GET" && req.method !== "HEAD") return undefined;
    const token = new URL(req.url ?? "/", "http://x").searchParams.get("access_token") ?? undefined;
    return getPlexSession(token, "admin-media");
  }

  /** Gate a non-tRPC route. Returns true when it answered 401 and the caller should stop. */
  function rejectIfNotAdmin(req: IncomingMessage, res: ServerResponse): boolean {
    if (isAdminRequest(req)) return false;
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Sign in to continue." }));
    return true;
  }

  /**
   * Best-effort client address for rate-limiting the auth handshake. Behind a
   * reverse proxy every socket address is the proxy's, so the forwarded header
   * is the only thing that distinguishes callers — it's spoofable, but the
   * limiter is a courtesy to plex.tv rather than a security boundary.
   */
  return { isAdminRequest, rejectIfNotAdmin };
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}
