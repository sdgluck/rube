/**
 * Everything the app does once, before React renders.
 *
 * In a browser this is a no-op that resolves immediately, which is what lets
 * both SPAs call it unconditionally from `main.tsx`.
 *
 * - Load the connection from device storage, so `apiUrl`/`authHeaders` are
 *   right on the very first request.
 * - The platform stamp, from Capacitor rather than the user agent.
 * - The page runs edge to edge under both system bars (`SystemBars` in
 *   capacitor.config.ts, `viewport-fit=cover`); the CSS pads with the
 *   `safe-area-inset-*` values.
 * - Android's hardware back button walks the router history, then leaves.
 * - Deep links (`tinkerbell://…`), including the one that launched the app.
 *
 * The splash screen is hidden by the app itself (`hideSplash`) after its first
 * render, not here — hiding it before React has painted shows a white frame.
 */
import { App } from "@capacitor/app";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { NATIVE_APPS, type NativeApp } from "@tinkerbell/contracts";
import { parseDeepLink, type DeepLink } from "./deep-links.ts";
import { interceptExternalLinks } from "./files.ts";
import { watchKeyboard } from "./keyboard.ts";
import { applyPlatform } from "./platform.ts";
import { navigateBack } from "./transitions.ts";
import { loadConnection } from "./storage.ts";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

const deepLinkListeners = new Set<(link: DeepLink) => void>();
let pendingLink: DeepLink | null = null;

/**
 * Subscribe to deep links. A link that arrived before anything subscribed
 * (the one that cold-started the app) is delivered to the first subscriber.
 */
export function onDeepLink(listener: (link: DeepLink) => void): () => void {
  deepLinkListeners.add(listener);
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    listener(link);
  }
  return () => deepLinkListeners.delete(listener);
}

function deliver(link: DeepLink | null): void {
  if (!link) return;
  if (deepLinkListeners.size === 0) pendingLink = link;
  for (const listener of deepLinkListeners) listener(link);
}

export async function bootNative(app: NativeApp): Promise<void> {
  // Phones in a browser too: the tab bar hides while typing either way.
  void watchKeyboard();
  if (!isNative()) return;
  const { scheme } = NATIVE_APPS[app];

  applyPlatform({ platform: Capacitor.getPlatform() });
  interceptExternalLinks();

  // iOS: a tap on the status bar scrolls to the top. Capacitor relays it as a
  // window event; the phone layouts scroll the document, so this is the scroller.
  window.addEventListener("statusTap", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  await loadConnection();

  // Android's back key: close the open sheet (its history entry), else pop a
  // screen with the pop animation, else leave the app.
  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) navigateBack();
    else void App.exitApp();
  });

  await App.addListener("appUrlOpen", ({ url }) => deliver(parseDeepLink(url, scheme)));
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (launch?.url) deliver(parseDeepLink(launch.url, scheme));
}

/**
 * Light system-bar icons on a dark theme, dark on a light one — the status bar
 * and, on Android, the navigation bar both. The app's own theme setting can
 * differ from the phone's, so following the device appearance isn't enough.
 */
export function setStatusBarTheme(theme: "light" | "dark"): void {
  if (!isNative()) return;
  void SystemBars.setStyle({ style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

export function hideSplash(): void {
  if (!isNative()) return;
  void SplashScreen.hide().catch(() => {});
}

/**
 * Call `listener` when the app returns to the foreground — the native app
 * resuming, or a browser tab becoming visible again. Lists refetch on it: a
 * phone app opened from the background showing hours-old data with no way to
 * tell is the stalest-feeling thing an app can do.
 */
export function onResume(listener: () => void): () => void {
  if (isNative()) {
    const handle = App.addListener("resume", listener);
    return () => void handle.then((h) => h.remove());
  }
  const onVisible = () => document.visibilityState === "visible" && listener();
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
