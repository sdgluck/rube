/**
 * Side-effect hooks that domains register at startup. Lives here so a
 * higher-level domain can poke a lower-level one without forming an
 * import cycle. Mirrors the pattern used by `setHealthReporter` in
 * `clients.ts`.
 *
 * Today: `setPostCollectionSyncHook` lets `domains/migration` plug into
 * the end of `domains/collections.syncCollections` so a Plex sync
 * automatically refreshes Kometa/etc provider scans without
 * `domains/collections` importing `domains/migration`.
 */

type PostCollectionSyncHook = () => Promise<void> | void;

let postCollectionSyncHook: PostCollectionSyncHook = async () => {};

export function setPostCollectionSyncHook(next: PostCollectionSyncHook): void {
  postCollectionSyncHook = next;
}

export async function runPostCollectionSyncHook(): Promise<void> {
  await postCollectionSyncHook();
}
