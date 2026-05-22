/**
 * Defence-in-depth checks on outbound URLs sourced from admin-supplied
 * config. The server is loopback-only by default (see apps/server bind),
 * so the practical exposure today is small — but if a future tRPC route
 * is ever reachable without auth, an admin-controlled URL becomes an
 * SSRF probe vector. These checks make that harder by default.
 *
 * Dev mode (NODE_ENV !== "production") stays permissive because local
 * Plex/Arr/Seerr instances normally live on RFC1918. Production rejects
 * private/loopback/link-local hostnames unless the operator opts in
 * via TINKERBELL_ALLOW_PRIVATE_OUTBOUND=1.
 */

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(?:\.\d+){3}$/,
  /^0\.0\.0\.0$/,
  /^10(?:\.\d+){3}$/,
  /^192\.168(?:\.\d+){2}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}$/,
  /^169\.254(?:\.\d+){2}$/, // link-local incl. cloud metadata
  /^::1$/,
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique-local /7
  /^fd[0-9a-f]{2}:/i,
];

function isPrivateHost(hostname: string): boolean {
  // URL parsing leaves IPv6 hosts wrapped in brackets — strip them.
  const h = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(h));
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Throws {@link UnsafeUrlError} if `url` is not safe to fetch as an
 * outbound request. Pass `allowPrivate` from a config flag if the caller
 * genuinely needs to reach RFC1918 (e.g. an on-LAN Plex server).
 */
export function assertSafeOutboundUrl(url: string | URL, opts: { allowPrivate?: boolean } = {}): void {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${String(url)}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(`Disallowed protocol ${parsed.protocol} in ${parsed.href}`);
  }

  const allowPrivate =
    opts.allowPrivate || process.env.NODE_ENV !== "production" || process.env.TINKERBELL_ALLOW_PRIVATE_OUTBOUND === "1";

  if (!allowPrivate && isPrivateHost(parsed.hostname)) {
    throw new UnsafeUrlError(
      `Refusing to fetch private/loopback address ${parsed.hostname}. ` +
        `Set TINKERBELL_ALLOW_PRIVATE_OUTBOUND=1 to opt in.`,
    );
  }
}
