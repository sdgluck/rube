/**
 * Turning what somebody typed into a server address, and deciding whether the
 * server at it is one this build can talk to.
 *
 * People type `192.168.1.10:3000`, `tinkerbell.example.com/` or paste a URL
 * with a path from their address bar. The picker tries each candidate this
 * returns until one answers `auth.server`. Without a scheme, HTTPS goes first —
 * a name that serves both should use the encrypted one — and plain HTTP second,
 * because a LAN address with a port is usually exactly that.
 *
 * Pure, so it is unit-tested under node.
 */

export function serverCandidates(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const attempts = hasScheme ? [trimmed] : [`https://${trimmed}`, `http://${trimmed}`];
  const out: string[] = [];
  for (const attempt of attempts) {
    let url: URL;
    try {
      url = new URL(attempt);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    // Only the origin. A pasted `/settings/api` path is where the user was,
    // not where the API is — and a reverse proxy serving Tinkerbell under a
    // sub-path is not something the SPA supports either.
    if (!out.includes(url.origin)) out.push(url.origin);
  }
  return out;
}

/** Numeric compare of `x.y.z`; anything after a `-` is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * The oldest server the bundled UI can drive.
 *
 * The app's UI is fixed at build time while the server updates on its own
 * schedule, so an app from the store will meet servers both older and newer
 * than itself. Newer is the server's problem: it has to keep answering the
 * procedures an older app calls. Older is this constant's: bump it in the same
 * commit that makes either SPA call a procedure a released server lacks.
 * `auth.server` itself arrived with the native apps, so any server that
 * answers it is at least this.
 */
export const MIN_SERVER_VERSION = "0.35.0";

export type ServerProduct = "tinkerbell-admin" | "tinkerbell-portal";

export type ServerCheck =
  | { ok: true; server: string; version: string }
  | { ok: false; reason: "unreachable" | "not-tinkerbell" | "wrong-app" | "too-old"; detail?: string };

/** Judge one candidate's `auth.server` answer. Separate from the fetch so it can be tested. */
export function judgeServerInfo(server: string, info: unknown, want: ServerProduct): ServerCheck {
  const data = (info as { result?: { data?: { product?: unknown; version?: unknown } } })?.result?.data;
  if (typeof data?.product !== "string" || typeof data.version !== "string") {
    return { ok: false, reason: "not-tinkerbell" };
  }
  if (data.product !== want) return { ok: false, reason: "wrong-app", detail: data.product };
  if (compareVersions(data.version, MIN_SERVER_VERSION) < 0) {
    return { ok: false, reason: "too-old", detail: data.version };
  }
  return { ok: true, server, version: data.version };
}
