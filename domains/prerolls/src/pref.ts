/**
 * Building the `CinemaTrailersPrerollID` value.
 *
 * Kept free of DB and filesystem access so the string-assembly rules — which
 * are the part that silently breaks playback when wrong — can be tested
 * directly.
 */

export type PrerollMode = "random" | "sequential";

/**
 * Plex's own convention, and the entire reason the mode toggle exists:
 * semicolons mean "pick one at random per playback", commas mean "play all of
 * these in order".
 *
 * They read backwards, which is exactly how they came to be inverted here for
 * several releases — silently swapping the two modes. Don't "tidy" them.
 */
export const MODE_SEPARATORS: Record<PrerollMode, string> = {
  random: ";",
  sequential: ",",
};

/**
 * Join a Plex-side directory and a filename with forward slashes.
 *
 * Deliberately not `path.join` — the path being built belongs to the *Plex*
 * server, which may be Linux while Tinkerbell runs on Windows, or vice versa.
 * Windows Plex accepts forward slashes, so they're the safe common form.
 */
export function joinPlexPath(plexDir: string, filename: string): string {
  const base = plexDir.replace(/[/\\]+$/, "");
  return base ? `${base}/${filename}` : filename;
}

/**
 * Assemble the preference value from the enabled prerolls' filenames.
 *
 * Returns "" when there's nothing to play, which is also how the preroll
 * feature is turned off — Plex treats an empty value as "no pre-roll".
 */
export function buildPrefValue(filenames: string[], plexDir: string, mode: PrerollMode): string {
  return filenames.map((f) => joinPlexPath(plexDir, f)).join(MODE_SEPARATORS[mode]);
}

/**
 * Compare what we intend against what Plex reports.
 *
 * Plex normalises nothing, but it does round-trip the value verbatim, so an
 * exact match after trimming is a reliable "in sync" signal.
 */
export function prefsMatch(expected: string, actual: string): boolean {
  return expected.trim() === actual.trim();
}
