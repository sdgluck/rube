/**
 * HLS playlist parsing for the stress harness, kept apart from the ramp so it
 * can be tested without a Plex server.
 *
 * Both functions exist because the original string-surgery versions were wrong
 * in ways no one noticed while the harness itself was dead:
 *
 *  - a variant line is frequently an *absolute* URL, and prefixing it with
 *    `/video/:/transcode/universal/` produced
 *    `/video/:/transcode/universal/http://host/…`, which 404s;
 *  - the base for relative segments was derived with
 *    `lastIndexOf("/")` over a URL that carries a query string, so any `/`
 *    inside the query silently produced a garbage base.
 *
 * Resolution goes through the WHATWG URL parser, which gets both right by
 * construction.
 */

/** Lines of a playlist, trimmed, with blanks dropped. */
function playlistLines(m3u8: string): string[] {
  return m3u8
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function isMasterPlaylist(m3u8: string): boolean {
  return playlistLines(m3u8).some((l) => l.startsWith("#EXT-X-STREAM-INF"));
}

/**
 * The first variant stream URL of a master playlist, resolved against `base`.
 *
 * Returns an absolute URL string. Throws if the playlist has no variant — the
 * caller cannot make a session out of that and should fail the step loudly.
 */
export function resolveVariantUrl(m3u8: string, base: string): string {
  const lines = playlistLines(m3u8);
  const variant = lines.find((l, i) => i > 0 && lines[i - 1].startsWith("#EXT-X-STREAM-INF") && !l.startsWith("#"));
  if (!variant) throw new Error("Master playlist has no variant stream URLs");
  return new URL(variant, base).toString();
}

/**
 * Every segment URL in a media playlist, resolved against the playlist's own
 * URL — so relative segment names inherit the playlist's directory *and* its
 * query is correctly discarded rather than treated as part of the path.
 */
export function resolveSegmentUrls(m3u8: string, playlistUrl: string): string[] {
  return playlistLines(m3u8)
    .filter((l) => !l.startsWith("#"))
    .map((seg) => new URL(seg, playlistUrl).toString());
}
