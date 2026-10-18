/**
 * The native app (SwiftUI on iOS, Compose on Android, under `native/`).
 *
 * One app for everyone: the Portal part for anybody this server shares with,
 * plus the Admin part for whoever can administer it. The two servers stay
 * separate — the app simply holds a connection to each — so a link can name
 * either address or both.
 *
 * The native app makes plain URLSession/OkHttp requests with no `Origin`, so
 * it needs no CORS entry; that is why there is no hostname here.
 */
export const NATIVE_APP = {
  appId: "dev.tinkerbell.app",
  scheme: "tinkerbell",
} as const;

/**
 * `tinkerbell://connect?admin=…&portal=…` — what a Settings QR code holds.
 *
 * The app treats it as a suggestion: it fills in the connect screen for the
 * person to confirm, and probes each address before trusting it with a
 * sign-in. Either half may be missing — the portal page shares only the
 * portal's address, because the people it is shown to have no admin to reach.
 */
export function nativeConnectLink(servers: { admin?: string | null; portal?: string | null }): string {
  const params = new URLSearchParams();
  if (servers.admin) params.set("admin", servers.admin);
  if (servers.portal) params.set("portal", servers.portal);
  return `${NATIVE_APP.scheme}://connect?${params.toString()}`;
}

/**
 * Whether an address is this machine's own — `localhost`, `127.x`, `::1`. A
 * phone scanning a code for one of those reaches itself, not the server, so
 * Settings says so instead of showing a code that can't work.
 */
export function isLoopbackAddress(address: string): boolean {
  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host.startsWith("127.") ||
    host === "0.0.0.0"
  );
}
