/**
 * What this instance can do, derived from its version.
 *
 * Every version-dependent branch in the codebase must go through here, and
 * must ask about a *capability* rather than about a service or a version
 * number. The reason is that "Radarr or Sonarr?" is almost never the real
 * question — "does this instance have custom formats?" is, and the answer is
 * yes for Radarr v3+ and for Sonarr v4+ but not Sonarr v3. Branching on the
 * service gets that wrong in a way that is invisible until someone with an
 * older install opens the settings page.
 *
 * An unparseable or absent version is treated as **modern**. A fresh install
 * is far likelier than a decade-old one, and the failure mode of guessing
 * modern (a settings section that errors) is more legible than the failure
 * mode of guessing ancient (a section silently missing).
 */

export const RADARR_CAPABILITIES = ["customFormats", "movieEditor", "collections"] as const;
export type RadarrCapability = (typeof RADARR_CAPABILITIES)[number];

export function parseMajor(version: string): number | null {
  const m = /^(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : null;
}

export function capabilitiesFor(version: string): RadarrCapability[] {
  const major = parseMajor(version);
  const caps: RadarrCapability[] = ["customFormats", "movieEditor"];
  // Collections became a first-class entity in v4.
  if (major === null || major >= 4) caps.push("collections");
  return caps;
}
