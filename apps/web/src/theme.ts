/* ─── Colour scheme ─────────────────────────────────────────────────────────
 *
 * Three modes — `system`, `light`, `dark` — resolving to one of two *applied*
 * themes, written to `document.documentElement` as `data-theme`.
 *
 * The stylesheet only ever sees the resolved value. There is no
 * `prefers-color-scheme` block in App.css any more: one set of dark tokens
 * under `:root[data-theme="dark"]` beats keeping a media-query copy of the same
 * eighty declarations in sync with it, and the media query could not have
 * expressed "system, unless the user pinned it" without that duplication
 * anyway. Resolving the media query here instead means `matchMedia` has to be
 * watched while in `system` mode, which `startThemeWatch` does.
 *
 * The mirror in localStorage is what `index.html`'s boot script reads. It runs
 * before the first paint; the server config that actually owns this preference
 * arrives several hundred milliseconds later, which is far too late to decide
 * what colour the page is.
 */

import { setStatusBarTheme } from "@tinkerbell/native-client";
import { readEnumStorage, readStorage, writeStorage } from "#/storage";

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = "light" | "dark";

/** Shared with the boot script in `index.html` — keep the two spellings equal. */
export const THEME_STORAGE_KEY = "tb.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();
let mode: ThemeMode = readEnumStorage(THEME_STORAGE_KEY, THEME_MODES, "system");

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(m: ThemeMode): ResolvedTheme {
  return m === "system" ? systemTheme() : m;
}

/** Paints the resolved theme onto `<html>`. Idempotent. */
function apply(): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  // The address-bar / status-bar colour is chrome outside the stylesheet's
  // reach, so it has to be told separately or a light page keeps a dark strip.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0a100f" : "#edf1f0");
  // The native app's status bar is the same chrome, told a different way.
  setStatusBarTheme(resolved);
}

export function getThemeMode(): ThemeMode {
  return mode;
}

/**
 * Has this browser been told a mode, as opposed to defaulting to `system`?
 *
 * The two are the same value and a different fact: an unset key means the
 * server's stored preference should win, and a stored `"system"` means this
 * browser was explicitly put back on the OS setting and should stay there.
 */
export function hasStoredTheme(): boolean {
  return readStorage(THEME_STORAGE_KEY) !== null;
}

/**
 * Sets the mode, repaints, and notifies subscribers.
 *
 * `persist: false` is for adopting the server's stored value on load — that is
 * the config telling the browser what it already decided, and writing it back
 * would be a round trip saying nothing.
 */
export function setThemeMode(next: ThemeMode, { persist = true }: { persist?: boolean } = {}): void {
  if (next === mode) return;
  mode = next;
  if (persist) writeStorage(THEME_STORAGE_KEY, next);
  apply();
  for (const fn of listeners) fn();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Follows the OS while in `system` mode.
 *
 * Called once from `main.tsx` rather than from a hook: the subscription belongs
 * to the document, not to whichever component happens to be showing the
 * toggle, and unmounting the settings page must not strand the page on
 * yesterday's scheme.
 */
export function startThemeWatch(): void {
  apply();
  if (typeof matchMedia !== "function") return;
  matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (mode === "system") {
      apply();
      for (const fn of listeners) fn();
    }
  });
}
