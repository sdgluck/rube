/**
 * Whether the backup directory would survive the container being replaced.
 *
 * The failure this exists for is silent: backups written to a path inside the
 * container's own filesystem look exactly like good ones — the job succeeds,
 * the list fills up — until the container is recreated and they go with it.
 * The page used to warn about it in a sentence everyone reads past; this asks
 * the filesystem instead.
 *
 * The test is a device comparison. A bind mount or a named volume is a
 * different device from the container's root; a plain directory under `/` is
 * the same one. That reading only means something inside a container — on a
 * bare install everything on the root disk is "the same device as /" and is
 * perfectly durable — so outside one the answer is `null`, and the page shows
 * nothing rather than a warning that would be wrong.
 */
import { existsSync } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type BackupDirMount = "mounted" | "container";

export interface MountCheckOptions {
  /** Defaults to sniffing the marker files Docker and Podman leave at the root. */
  inContainer?: boolean;
  /** The container's root. A seam for tests; always `/` for real. */
  root?: string;
  /** A seam for tests, which cannot conjure a second device on demand. */
  stat?: (path: string) => Promise<{ dev: number }>;
}

export function runningInContainer(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/**
 * `mounted` when `dir` is on a different device from the root, `container`
 * when it is on the root's own, `null` outside a container or when nothing on
 * the path can be read.
 *
 * The directory need not exist yet — the backup job creates it — so the
 * nearest existing ancestor stands in for it: that is the device the job's
 * `mkdir` will land on.
 */
export async function backupDirMount(dir: string, opts: MountCheckOptions = {}): Promise<BackupDirMount | null> {
  if (!(opts.inContainer ?? runningInContainer())) return null;
  const stat = opts.stat ?? fsStat;

  let probe = resolve(dir);
  let dev: number | undefined;
  for (;;) {
    dev = await stat(probe).then(
      (s) => s.dev,
      () => undefined,
    );
    if (dev !== undefined) break;
    const parent = dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }

  const rootDev = await stat(opts.root ?? "/").then(
    (s) => s.dev,
    () => undefined,
  );
  if (rootDev === undefined) return null;
  return dev === rootDev ? "container" : "mounted";
}
