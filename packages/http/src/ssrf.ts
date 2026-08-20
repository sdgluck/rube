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
  /^::$/, // IPv6 unspecified, the twin of 0.0.0.0
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique-local /7
  /^fd[0-9a-f]{2}:/i,
];

/**
 * An IPv4-mapped IPv6 address, as the dotted-quad it stands for.
 *
 * `http://[::ffff:127.0.0.1]/` reaches loopback, but `URL` rewrites the host to
 * `[::ffff:7f00:1]` — which matches none of the patterns above, so the guard
 * waved it through. Unmapping first means one set of IPv4 rules covers both
 * spellings instead of needing a hex twin for every range.
 *
 * Both forms are handled because `URL` only compresses the ones it parses from
 * dotted-quad; a caller passing a pre-built `URL` can still carry either.
 */
function unmapIpv4(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (dotted) return dotted[1]!;

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex) return null;
  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function isPrivateHost(hostname: string): boolean {
  // URL parsing leaves IPv6 hosts wrapped in brackets — strip them.
  let h = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  // A single trailing dot makes an absolute name: `127.0.0.1.` resolves to
  // loopback. `URL` strips it from a dotted-quad but keeps it on a name, and
  // the patterns below are anchored, so it has to come off here.
  if (h.endsWith(".") && !h.endsWith("..")) h = h.slice(0, -1);

  const mapped = unmapIpv4(h.toLowerCase());
  if (mapped) h = mapped;

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
