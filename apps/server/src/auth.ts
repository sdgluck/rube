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
 * Two credentials get through, for two kinds of caller:
 *
 * - the `tb_admin_session` cookie — the browser SPA, served from this origin;
 * - `Authorization: Bearer <session>` — the native app, whose HTTP stack sends
 *   the header on image requests too.
 *
 * Nothing is accepted from the query string. The retired Capacitor apps took a
 * `?access_token=` media token here because a WebView's `<img>` can't send a
 * header; the native app has no such limit, and a credential in a URL lands in
 * proxy logs and `Referer`s.
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
    const session = getPlexSession(raw, "admin");
    return !!session && isAdminAccount(session.userId);
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
