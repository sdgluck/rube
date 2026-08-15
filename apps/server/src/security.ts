import { resolve, sep } from "node:path";

/**
 * Resolve a request URL pathname against the dist root, returning either
 * the absolute file path to serve or `null` if the request escapes the
 * root. Centralised here (and tested in security.test.ts) because the
 * naive `path.join(DIST_DIR, urlPath)` form normalises `..` away and lets
 * `/../../etc/passwd` reach `/etc/passwd`.
 */
export function resolveStaticPath(distDir: string, urlPathname: string): string | null {
  const requestedPath = urlPathname === "/" ? "index.html" : decodeURIComponent(urlPathname);
  const resolved = resolve(distDir, "." + (requestedPath.startsWith("/") ? requestedPath : "/" + requestedPath));
  if (resolved === distDir || resolved.startsWith(distDir + sep)) return resolved;
  return null;
}

/**
 * Read one cookie out of a `Cookie:` header. Lives here rather than beside
 * the session lookup so it can be unit-tested without importing anything that
 * opens the database — the header is attacker-controlled and the parsing has
 * to be right (a `Cookie: other=x; tb_admin_session=…` header must still
 * yield the second value, and a prefix like `xtb_admin_session` must not
 * match).
 */
export function parseCookieHeader(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** Canonical v4 UUID, which is what `randomUUID()` produces. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the `:id` segment of a `/api/prerolls/:id/…` request.
 *
 * Preroll files are named after their row's UUID, so rather than resolving a
 * caller-supplied path and checking it stayed inside the directory, we refuse
 * anything that isn't a UUID in the first place — traversal, absolute paths
 * and encoded separators all fail the shape test before touching the disk.
 */
export function resolvePrerollId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding — nothing legitimate produces this.
    return null;
  }
  return UUID_RE.test(decoded) ? decoded.toLowerCase() : null;
}

/**
 * Decide whether a `/api/plex-image?path=…` request is safe to forward.
 * Returns the upstream URL to fetch (with token attached) or `null` to
 * reject. Rejects:
 *  - missing/empty path or non-leading-slash
 *  - protocol-relative or absolute URLs (`//evil.com/x`, `http://evil.com`)
 *  - paths whose resolved origin differs from the configured Plex origin
 */
export function buildPlexImageUrl(args: {
  thumbPath: string | null;
  plexUrl: string | undefined;
  plexToken: string | undefined;
}): URL | null {
  const { thumbPath, plexUrl, plexToken } = args;
  if (
    !thumbPath ||
    !thumbPath.startsWith("/") ||
    thumbPath.startsWith("//") ||
    thumbPath.startsWith("/\\") ||
    thumbPath.includes("://") ||
    !plexUrl ||
    !plexToken
  ) {
    return null;
  }
  let plexOrigin: string;
  try {
    plexOrigin = new URL(plexUrl).origin;
  } catch {
    return null;
  }
  const imageUrl = new URL(thumbPath, plexUrl);
  if (imageUrl.origin !== plexOrigin) return null;
  imageUrl.searchParams.set("X-Plex-Token", plexToken);
  return imageUrl;
}
