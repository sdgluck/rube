/**
 * Which platform's conventions the UI should follow: iOS, Android, or neither.
 *
 * The phone layouts are the same on both platforms, but the details that make
 * an app feel native are not — iOS has large titles, slide-in pushes and
 * grouped inset lists; Android has a left-aligned top bar, fade-through
 * transitions and Material sheets. Stylesheets read `<html data-platform>` for
 * those details, so it has to be right before first paint: each `index.html`
 * runs the same detection inline.
 *
 * `?platform=` overrides detection, which is how the screenshot harness
 * captures both looks from one desktop Chromium.
 *
 * Pure apart from reading `navigator`, so the detection is unit-tested under node.
 */

export type Platform = "ios" | "android" | "desktop";

const PLATFORMS: readonly Platform[] = ["ios", "android", "desktop"];

export function detectPlatform(input: { userAgent: string; maxTouchPoints: number; search?: string }): Platform {
  const forced = new URLSearchParams(input.search ?? "").get("platform");
  if (forced && (PLATFORMS as readonly string[]).includes(forced)) return forced as Platform;
  const ua = input.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS reports itself as a Mac; a Mac with a touchscreen is an iPad.
  if (/macintosh/i.test(ua) && input.maxTouchPoints > 1) return "ios";
  return "desktop";
}

/** The platform `<html>` was stamped with, or detected now if it wasn't. */
export function getPlatform(): Platform {
  const stamped = typeof document === "undefined" ? undefined : document.documentElement.dataset.platform;
  if (stamped && (PLATFORMS as readonly string[]).includes(stamped)) return stamped as Platform;
  if (typeof navigator === "undefined") return "desktop";
  return detectPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    search: typeof location === "undefined" ? "" : location.search,
  });
}
