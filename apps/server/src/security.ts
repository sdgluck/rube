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
