/* ─── Persisted UI preferences ──────────────────────────────────────────────
 *
 * Every localStorage access goes through here. Touching localStorage directly
 * throws where storage is unavailable or full — Safari private browsing, some
 * embedded webviews, a hardened browser profile — and because these reads sit
 * in useState initialisers, an exception white-screens the whole page rather
 * than degrading to a default.
 */

/** Reads a key, or null if storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a key, silently doing nothing if storage is unavailable or full. */
export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a nice-to-have; failing to persist one is not an error
    // worth surfacing to the user.
  }
}

export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* see writeStorage */
  }
}

/** Narrows an arbitrary string to a known union, falling back when it doesn't fit. */
export function readEnum<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readEnumStorage<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  return readEnum(readStorage(key), allowed, fallback);
}

/** Reads and parses JSON, falling back on absent, unreadable or invalid data. */
export function readJsonStorage<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown): void {
  try {
    writeStorage(key, JSON.stringify(value));
  } catch {
    /* value wasn't serialisable — nothing useful to persist */
  }
}
