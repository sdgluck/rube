/**
 * Fetches and caches the public registry index.
 *
 * The payload is remote content that ends up creating rules against somebody's
 * Plex server, so it is parsed strictly rather than trusted: an unknown
 * `formatVersion` is refused outright instead of being read with today's
 * assumptions.
 */
import { httpRequestJson } from "@tinkerbell/http";
import { getConfig, setConfig } from "@tinkerbell/core";
import { DEFAULT_REGISTRY_URL, registryIndexSchema, type RegistryIndex } from "@tinkerbell/contracts";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export function registryUrl(): string {
  return process.env.REGISTRY_URL || DEFAULT_REGISTRY_URL;
}

interface CachedIndex {
  fetchedAt: number;
  url: string;
  index: RegistryIndex;
}

function readCache(): CachedIndex | null {
  const cached = getConfig("registry_cache") as CachedIndex | undefined;
  if (!cached) return null;
  // A changed REGISTRY_URL must not be served the previous URL's catalogue.
  if (cached.url !== registryUrl()) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
  const parsed = registryIndexSchema.safeParse(cached.index);
  return parsed.success ? { ...cached, index: parsed.data } : null;
}

export async function fetchRegistryIndex(opts: { force?: boolean } = {}): Promise<RegistryIndex> {
  if (!opts.force) {
    const cached = readCache();
    if (cached) return cached.index;
  }

  const url = registryUrl();
  let payload: unknown;
  try {
    payload = await httpRequestJson<unknown>({ url, timeoutMs: FETCH_TIMEOUT_MS, retries: 2 });
  } catch (err) {
    // Plenty of Tinkerbell installs have no outbound internet at all. Say so
    // plainly rather than surfacing a bare fetch error.
    throw new Error(
      `Could not reach the rule registry at ${url}. Check this server's internet access, then try again. (${
        (err as Error).message
      })`,
    );
  }

  const parsed = registryIndexSchema.safeParse(payload);
  if (!parsed.success) {
    const version = (payload as { formatVersion?: unknown })?.formatVersion;
    if (typeof version === "number" && version > registryIndexSchema.shape.formatVersion.value) {
      throw new Error(
        `The rule registry uses format version ${version}, which this version of Tinkerbell doesn't understand. Update Tinkerbell to import from it.`,
      );
    }
    throw new Error(`The rule registry returned data Tinkerbell couldn't read: ${parsed.error.message}`);
  }

  setConfig("registry_cache", { fetchedAt: Date.now(), url, index: parsed.data });
  return parsed.data;
}

/** Cached catalogue plus the lookups every caller immediately builds. */
export async function getRegistry(opts: { force?: boolean } = {}) {
  const index = await fetchRegistryIndex(opts);
  return {
    index,
    packsBySlug: new Map(index.packs.map((p) => [p.slug, p])),
    rulesBySlug: new Map(index.rules.map((r) => [r.slug, r])),
  };
}
