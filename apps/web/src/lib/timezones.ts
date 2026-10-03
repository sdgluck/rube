/**
 * The zone list comes from the browser's own ICU data when available, so it
 * always matches what Node will accept. The fallback covers the handful of
 * older engines without `supportedValuesOf`.
 *
 * Shared by onboarding and Jobs → Schedule, which each had a copy.
 */
export function timezoneOptions(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      // Fall through to the pair below on an engine without ICU data.
    }
  }
  return ["UTC", Intl.DateTimeFormat().resolvedOptions().timeZone].filter(Boolean);
}
