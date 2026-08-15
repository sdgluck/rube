/**
 * Session cookie plumbing shared by the portal and admin routers.
 *
 * The two apps listen on different ports of (usually) the same host, and
 * cookies are not port-scoped — so they must use different names or signing
 * into one would clobber the other's session.
 */
import { sessionMaxAgeSeconds, type SessionScope } from "@tinkerbell/core";

export const COOKIE_NAMES: Record<SessionScope, string> = {
  portal: "tb_session",
  admin: "tb_admin_session",
};

/**
 * Carries the in-flight sign-in handshake. Holds an unguessable nonce, never
 * the plex.tv PIN id — the id stays server-side so no caller can present one
 * of their choosing.
 */
export const HANDSHAKE_COOKIE = "tb_admin_handshake";

/** Long enough for a human to finish signing in, short enough to age out. */
export const HANDSHAKE_MAX_AGE = 15 * 60; // seconds

export function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/**
 * Whether the browser reached us over HTTPS. `Secure` can't simply be set
 * unconditionally: a self-hoster on plain HTTP over the LAN would have the
 * browser drop the cookie and never be able to sign in. Behind a reverse proxy
 * the TLS terminates upstream, so the forwarded header is the only evidence.
 */
export function isSecureRequest(req: Request): boolean {
  const url = new URL(req.url);
  if (url.protocol === "https:") return true;
  const proto = req.headers.get("x-forwarded-proto") ?? "";
  return proto.split(",")[0].trim().toLowerCase() === "https";
}

export function setSessionCookie(headers: Headers, raw: string, opts: { scope: SessionScope; secure: boolean }): void {
  const attrs = [
    `${COOKIE_NAMES[opts.scope]}=${raw}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${sessionMaxAgeSeconds(opts.scope)}`,
    "SameSite=Lax",
  ];
  if (opts.secure) attrs.push("Secure");
  headers.append("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(headers: Headers, opts: { scope: SessionScope; secure: boolean }): void {
  const attrs = [`${COOKIE_NAMES[opts.scope]}=`, "HttpOnly", "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (opts.secure) attrs.push("Secure");
  headers.append("Set-Cookie", attrs.join("; "));
}

export function setHandshakeCookie(headers: Headers, nonce: string, opts: { secure: boolean }): void {
  const attrs = [`${HANDSHAKE_COOKIE}=${nonce}`, "HttpOnly", "Path=/", `Max-Age=${HANDSHAKE_MAX_AGE}`, "SameSite=Lax"];
  if (opts.secure) attrs.push("Secure");
  headers.append("Set-Cookie", attrs.join("; "));
}

export function clearHandshakeCookie(headers: Headers, opts: { secure: boolean }): void {
  const attrs = [`${HANDSHAKE_COOKIE}=`, "HttpOnly", "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (opts.secure) attrs.push("Secure");
  headers.append("Set-Cookie", attrs.join("; "));
}
