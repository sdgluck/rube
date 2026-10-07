/**
 * Where the app keeps its connection between launches.
 *
 * The session and media tokens go in the Keychain / Android Keystore
 * (`@aparajita/capacitor-secure-storage`), never Preferences or
 * `localStorage`: an admin session can delete every collection on the server,
 * and both of those are plain files in the app's container, readable from an
 * unencrypted device backup. The server address and the app-lock switch are
 * not secrets, so they live in Preferences.
 */
import { Preferences } from "@capacitor/preferences";
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";
import { getConnection, setConnection, type Connection } from "./connection.ts";

const SERVER_KEY = "tb.server";
const LOCK_KEY = "tb.lock";
const BANNER_KEY = "tb.dismissed";
const TOKEN_KEY = "tb.token";
const MEDIA_TOKEN_KEY = "tb.mediaToken";

async function readSecret(key: string): Promise<string | null> {
  try {
    const value = await SecureStorage.getItem(key);
    return value || null;
  } catch {
    // A Keychain item that can't be read (restored to a new device, where
    // `ThisDeviceOnly` items don't follow) is a signed-out app, not a crash.
    return null;
  }
}

async function writeSecret(key: string, value: string | null): Promise<void> {
  if (value) await SecureStorage.setItem(key, value);
  else await SecureStorage.removeItem(key).catch(() => {});
}

/** Fill the in-memory connection from device storage. Called once, before first render. */
export async function loadConnection(): Promise<Connection | null> {
  // This-device-only: a session restored from a backup onto another phone is
  // a credential that left the device it was issued to. Signing in again there
  // is one tap. (iOS only; Android's Keystore keys never leave the device.)
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly).catch(() => {});
  const { value: server } = await Preferences.get({ key: SERVER_KEY });
  if (!server) {
    setConnection(null);
    return null;
  }
  const connection = { server, token: await readSecret(TOKEN_KEY), mediaToken: await readSecret(MEDIA_TOKEN_KEY) };
  setConnection(connection);
  return connection;
}

/**
 * Point the app at a server. Switching servers drops the old credentials: a
 * session is only meaningful to the server that issued it, and presenting it
 * to another one hands that server a live token for the first.
 */
export async function saveServer(server: string | null): Promise<void> {
  const previous = getConnection();
  if (previous?.server === server) return;
  await writeSecret(TOKEN_KEY, null);
  await writeSecret(MEDIA_TOKEN_KEY, null);
  if (server) await Preferences.set({ key: SERVER_KEY, value: server });
  else await Preferences.remove({ key: SERVER_KEY });
  setConnection(server ? { server, token: null, mediaToken: null } : null);
}

export async function saveSession(token: string | null, mediaToken: string | null = null): Promise<void> {
  const connection = getConnection();
  if (!connection) return;
  await writeSecret(TOKEN_KEY, token);
  await writeSecret(MEDIA_TOKEN_KEY, mediaToken);
  setConnection({ ...connection, token, mediaToken });
}

export async function saveMediaToken(mediaToken: string | null): Promise<void> {
  const connection = getConnection();
  if (!connection) return;
  await writeSecret(MEDIA_TOKEN_KEY, mediaToken);
  setConnection({ ...connection, mediaToken });
}

export async function getLockEnabled(): Promise<boolean> {
  return (await Preferences.get({ key: LOCK_KEY })).value === "1";
}

export async function setLockEnabled(on: boolean): Promise<void> {
  await Preferences.set({ key: LOCK_KEY, value: on ? "1" : "0" });
}

/**
 * Banners the user dismissed, keyed by server — the "sign-in is off" warning
 * is about one server, so dismissing it for one must not hide it for the next.
 */
export async function isDismissed(id: string): Promise<boolean> {
  const server = getConnection()?.server ?? "";
  const { value } = await Preferences.get({ key: BANNER_KEY });
  return (value ?? "").split("\n").includes(`${server} ${id}`);
}

export async function dismiss(id: string): Promise<void> {
  const server = getConnection()?.server ?? "";
  const { value } = await Preferences.get({ key: BANNER_KEY });
  const set = new Set((value ?? "").split("\n").filter(Boolean));
  set.add(`${server} ${id}`);
  await Preferences.set({ key: BANNER_KEY, value: [...set].join("\n") });
}
