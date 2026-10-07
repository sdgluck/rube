/**
 * The native (Capacitor) side of the two SPAs.
 *
 * Browser-only code — it runs in the admin and portal SPAs, never in the
 * server — and every export is a no-op or a pass-through in an ordinary
 * browser, so the web build behaves exactly as it did before the apps existed.
 * No UI lives here: the portal must not import the admin app's design system,
 * so each app draws its own server picker and lock screen from these parts.
 */
export {
  apiUrl,
  authHeaders,
  getConnection,
  mediaUrl,
  setConnection,
  subscribeConnection,
  type Connection,
} from "./connection.ts";
export { bootNative, hideSplash, isNative, onDeepLink, setStatusBarTheme } from "./boot.ts";
export { connectLink, isInAppPath, parseDeepLink, type DeepLink } from "./deep-links.ts";
export { openExternal, saveFile } from "./files.ts";
export { biometryAvailable, unlock, watchLock } from "./lock.ts";
export { nativePlexSignIn, SignInCancelled, type NativeSignInCalls } from "./plex-sign-in.ts";
export { probeServer } from "./probe.ts";
export {
  compareVersions,
  MIN_SERVER_VERSION,
  serverCandidates,
  type ServerCheck,
  type ServerProduct,
} from "./server-url.ts";
export {
  dismiss,
  getLockEnabled,
  isDismissed,
  saveMediaToken,
  saveServer,
  saveSession,
  setLockEnabled,
} from "./storage.ts";
