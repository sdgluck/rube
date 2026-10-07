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
