/**
 * Everything the app does once, before React renders.
 *
 * In a browser this is a no-op that resolves immediately, which is what lets
 * both SPAs call it unconditionally from `main.tsx`.
 *
 * - Load the connection from device storage, so `apiUrl`/`authHeaders` are
 *   right on the very first request.
 * - Status bar: overlay the WebView (the CSS pads with `safe-area-inset-top`)
 *   and follow the app's light/dark theme.
 * - Android's hardware back button walks the router history, then leaves.
 * - Deep links (`tinkerbell://…`), including the one that launched the app.
 *
 * The splash screen is hidden by the app itself (`hideSplash`) after its first
 * render, not here — hiding it before React has painted shows a white frame.
 */
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { NATIVE_APPS, type NativeApp } from "@tinkerbell/contracts";
import { parseDeepLink, type DeepLink } from "./deep-links.ts";
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
  if (!isNative()) return;
  const { scheme } = NATIVE_APPS[app];

  await loadConnection();

  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});

  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });

  await App.addListener("appUrlOpen", ({ url }) => deliver(parseDeepLink(url, scheme)));
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (launch?.url) deliver(parseDeepLink(launch.url, scheme));
}

/** Light status-bar text on a dark theme, dark on a light one. */
export function setStatusBarTheme(theme: "light" | "dark"): void {
  if (!isNative()) return;
  void StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => {});
}

export function hideSplash(): void {
  if (!isNative()) return;
  void SplashScreen.hide().catch(() => {});
}
