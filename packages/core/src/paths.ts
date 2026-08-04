import { join } from "node:path";

/**
 * Tinkerbell's own storage root — `tinkerbell.db`, `sidequest.sqlite`, the
 * poster cache. Docker sets `DATA_DIR=/config`; outside a container we fall
 * back to the repo root, matching how `@tinkerbell/db` resolves it.
 */
export function dataDir(): string {
  return process.env.DATA_DIR || join(import.meta.dirname, "..", "..", "..");
}

/**
 * Where preroll videos live.
 *
 * Kept separate from `DATA_DIR` because this is the one directory that has to
 * be readable by *Plex* as well, which usually means its own bind mount. It
 * defaults under `DATA_DIR` so a single-volume install still works — see
 * `prerolls_plex_path` in config.ts for the Plex-side half of the mapping.
 */
export function prerollsDir(): string {
  return process.env.PREROLLS_DIR || join(dataDir(), "prerolls");
}

/** Raw uploads land here and are deleted once processing succeeds. */
export function prerollsIncomingDir(): string {
  return join(prerollsDir(), "incoming");
}

export function prerollsThumbsDir(): string {
  return join(prerollsDir(), "thumbs");
}
