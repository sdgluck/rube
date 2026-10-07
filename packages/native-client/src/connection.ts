/**
 * Which server the app talks to, and with what credentials.
 *
 * In a browser there is no connection and every helper here returns exactly
 * what the SPA always used: a relative `/api/...` path and no extra headers,
 * with the session riding along as the cookie. The browser build has to stay
 * the same request for request — this package exists so the native apps can
 * share the SPAs' code, not so the SPAs change.
 *
 * In the native apps the UI ships inside the binary and the server is wherever
 * the user pointed it, so every URL becomes absolute and the session travels
 * as a bearer token (a cookie from another origin is never sent back from
 * `capacitor://`).
 *
 * Synchronous on purpose. `<img src>` and the tRPC links read it during render
 * and on every request, so it is an in-memory value that `boot.ts` fills from
 * device storage once, before the first render — not a storage read per call.
 * Pure (no Capacitor import), so it is unit-tested under node.
 */

export interface Connection {
  /** Origin of the Tinkerbell server, no trailing slash: `https://tinkerbell.example`. */
  server: string;
  /** The session, as minted by `auth.poll` for a native handshake. Null until signed in. */
  token: string | null;
  /**
   * The admin app's short-lived `admin-media` token, for `<img>`/`<video>` —
   * which can't send a header. Never the session itself: that must not appear
   * in a URL. Null in the portal, and with admin auth off.
   */
  mediaToken: string | null;
}

let current: Connection | null = null;
const listeners = new Set<() => void>();

export function getConnection(): Connection | null {
  return current;
}

export function setConnection(next: Connection | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`. */
export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `/api/trpc` in a browser; `https://server/api/trpc` in the app. */
export function apiUrl(path: string): string {
  return current ? `${current.server}${path}` : path;
}

/** The bearer header in the app; nothing in a browser, where the cookie does the job. */
export function authHeaders(): Record<string, string> {
  return current?.token ? { Authorization: `Bearer ${current.token}` } : {};
}

/**
 * A URL for an `<img>` or `<video>` on one of the plain GET routes. In the app
 * it carries the media token, the only credential those tags can present.
 */
export function mediaUrl(path: string): string {
  if (!current) return path;
  if (!current.mediaToken) return `${current.server}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${current.server}${path}${sep}access_token=${encodeURIComponent(current.mediaToken)}`;
}
