/**
 * The two native (Capacitor) apps, as both ends need to know them.
 *
 * Each app serves its bundled UI from a fixed hostname of its own, which is
 * what gives it a recognisable origin — `capacitor://<host>` on iOS,
 * `https://<host>` on Android. The server allow-lists exactly those origins
 * for CORS (`apps/server/src/cors.ts`), and each app's `capacitor.config.ts`
 * sets `server.hostname` to the same value; `native-apps.test.ts` checks the
 * two haven't drifted, because a mismatch fails as "every request blocked by
 * CORS" with nothing in the server log.
 *
 * Neither hostname resolves anywhere. They are labels the WebView answers
 * itself, chosen so they can't collide with a real site — a plain
 * `https://localhost` would also be the origin of anything a developer ran on
 * their machine.
 */
export const NATIVE_APPS = {
  admin: {
    appId: "dev.tinkerbell.admin",
    hostname: "app.tinkerbell",
    /** The custom URL scheme for deep links: `tinkerbell://connect?server=…`. */
    scheme: "tinkerbell",
  },
  portal: {
    appId: "dev.tinkerbell.portal",
    hostname: "portal.tinkerbell",
    scheme: "tinkerbell-portal",
  },
} as const;

export type NativeApp = keyof typeof NATIVE_APPS;

/** Every origin an app's WebView can present: iOS's custom scheme and Android's https. */
export function nativeOrigins(app: NativeApp): string[] {
  const { hostname } = NATIVE_APPS[app];
  return [`capacitor://${hostname}`, `https://${hostname}`];
}

/**
 * The native app (SwiftUI on iOS, Compose on Android, under `native/`).
 *
 * One app for everyone: the Portal part for anybody this server shares with,
 * plus the Admin part for whoever can administer it. The two servers stay
 * separate — the app simply holds a connection to each — so a link can name
 * either address or both. `NATIVE_APPS` above is the Capacitor pair it
 * replaces, kept only until those builds are removed.
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
