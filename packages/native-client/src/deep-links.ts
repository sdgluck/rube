/**
 * The app's custom-scheme links.
 *
 * - `tinkerbell://connect?server=https://tinkerbell.example` — what the
 *   Settings → Mobile app QR code holds, so nobody has to type a LAN address
 *   on a phone keyboard. The portal app's is `tinkerbell-portal://connect?…`.
 * - `tinkerbell://open/rules/42` — opens that screen of the app.
 *
 * Any app on the phone can fire these, so neither is trusted. `connect` only
 * fills in the server picker for the user to confirm (it never silently swaps
 * the server the session belongs to), and `open` accepts a path inside the app
 * and nothing that could leave it.
 *
 * Pure, so it is unit-tested under node.
 */

export type DeepLink = { kind: "connect"; server: string } | { kind: "open"; path: string };

export function parseDeepLink(raw: string, scheme: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${scheme}:`) return null;

  // `tinkerbell://connect?…` parses with `connect` as the host; tolerate the
  // `tinkerbell:connect?…` and `tinkerbell:///connect` spellings too.
  const route = `${url.host}${url.pathname}`.replace(/^\/+/, "");
  const [action, ...rest] = route.split("/");

  if (action === "connect") {
    const server = url.searchParams.get("server");
    return server ? { kind: "connect", server } : null;
  }

  if (action === "open") {
    const path = `/${rest.join("/")}`;
    return isInAppPath(path) ? { kind: "open", path: `${path}${url.search}` } : null;
  }

  return null;
}

/** A same-app route: rooted, no scheme or protocol-relative escape, no traversal. */
export function isInAppPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes(":")) return false;
  return !path.split("/").some((segment) => segment === "..");
}

/** The link the admin shows as a QR code: open this app, pointed at that server. */
export function connectLink(scheme: string, server: string): string {
  return `${scheme}://connect?server=${encodeURIComponent(server)}`;
}
