/**
 * What this Sonarr can do, derived from its version.
 *
 * Sonarr is the app that makes capability-gating necessary rather than nice.
 * The v3→v4 boundary moved two whole settings concepts: custom formats did not
 * exist before v4, and language profiles do not exist after it. A settings page
 * that branched on "is this Sonarr?" would offer both to everyone and 404 for
 * half of them.
 *
 * An unparseable or absent version is treated as **modern**, as in Radarr: a
 * fresh install is far likelier than an ancient one, and a section that errors
 * is more legible than a section that silently isn't there.
 */

export const SONARR_CAPABILITIES = ["customFormats", "languageProfiles", "releaseProfiles", "seriesEditor"] as const;
export type SonarrCapability = (typeof SONARR_CAPABILITIES)[number];

export function parseMajor(version: string): number | null {
  const m = /^(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : null;
}

export function capabilitiesFor(version: string): SonarrCapability[] {
  const major = parseMajor(version);
  const modern = major === null || major >= 4;
  const caps: SonarrCapability[] = ["releaseProfiles", "seriesEditor"];
  if (modern) caps.push("customFormats");
  // v3 only. The one capability that is *lost* by upgrading, which is why this
  // cannot be expressed as a minimum version.
  if (major !== null && major <= 3) caps.push("languageProfiles");
  return caps;
}
