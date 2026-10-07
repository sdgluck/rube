/**
 * Face ID / fingerprint in front of a stored session.
 *
 * Opt-in. The session already sits in the Keychain, so this protects against
 * someone holding the unlocked phone rather than against theft of the token;
 * for an app that can delete a media library, that is a check worth offering
 * but not one to impose on a portal user who only picks genres.
 *
 * It locks on a cold start and on returning after `RELOCK_AFTER_MS` in the
 * background. Relocking on every app switch would make copying a URL from
 * Safari into the server picker a Face ID prompt each way.
 */
import { App } from "@capacitor/app";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";
import { getLockEnabled } from "./storage.ts";

const RELOCK_AFTER_MS = 5 * 60_000;

export async function biometryAvailable(): Promise<boolean> {
  try {
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
}

/** Resolves true when unlocked; false when the user cancelled. */
export async function unlock(reason: string): Promise<boolean> {
  try {
    // Device passcode as the fallback, so a failed face scan isn't a lockout
    // from the user's own app.
    await BiometricAuth.authenticate({ reason, allowDeviceCredential: true, androidTitle: "Unlock Tinkerbell" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Call `onLock` whenever the app should show its lock screen: now, if the
 * lock is on, and on any return from a long enough absence.
 */
export async function watchLock(onLock: () => void): Promise<() => void> {
  if (await getLockEnabled()) onLock();
  let backgroundedAt: number | null = null;
  const handle = await App.addListener("appStateChange", async ({ isActive }) => {
    if (!isActive) {
      backgroundedAt = Date.now();
      return;
    }
    const away = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
    backgroundedAt = null;
    if (away >= RELOCK_AFTER_MS && (await getLockEnabled())) onLock();
  });
  return () => void handle.remove();
}
