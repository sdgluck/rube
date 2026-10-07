/* ─── Interface size ────────────────────────────────────────────────────────
 *
 * One multiplier, written to `<html>` as `--ui-scale`, which App.css folds into
 * the root font size. Every length in the stylesheets is a rem, so this is the
 * whole of what it takes to make the app smaller or larger.
 *
 * Same shape as `theme.ts` and for the same reason: the localStorage mirror is
 * what `index.html`'s boot script reads before first paint. Without it the
 * page would draw at 100% and then jump to the chosen size when the config
 * query landed, reflowing everything under the pointer.
 */

import { DEFAULT_UI_SCALE, isUiScale, type UiScale } from "@tinkerbell/contracts";
import { readStorage, writeStorage } from "#/storage";

/** Shared with the boot script in `index.html` — keep the two spellings equal. */
export const UI_SCALE_STORAGE_KEY = "tb.scale";

function readStoredScale(): UiScale {
  const n = Number(readStorage(UI_SCALE_STORAGE_KEY));
  return isUiScale(n) ? n : DEFAULT_UI_SCALE;
}

const listeners = new Set<() => void>();
let scale: UiScale = readStoredScale();

function apply(): void {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
}

export function getUiScale(): UiScale {
  return scale;
}

/** Has this browser been told a size, as opposed to defaulting? See `hasStoredTheme`. */
export function hasStoredUiScale(): boolean {
  return readStorage(UI_SCALE_STORAGE_KEY) !== null;
}

/** Sets the size, repaints, and notifies subscribers. `persist: false` as in `setThemeMode`. */
export function setUiScale(next: UiScale, { persist = true }: { persist?: boolean } = {}): void {
  if (next === scale) return;
  scale = next;
  if (persist) writeStorage(UI_SCALE_STORAGE_KEY, String(next));
  apply();
  for (const fn of listeners) fn();
}

export function subscribeUiScale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-applies on load; the boot script has normally done it already. */
export function startUiScale(): void {
  apply();
}
