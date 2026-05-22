/**
 * Side-effect hooks that domains register at startup. Lives here so a
 * higher-level domain can poke (or read from) a lower-level one without
 * forming an import cycle. Mirrors the pattern used by `setHealthReporter`
 * in `clients.ts`.
 *
 * - `setPostCollectionSyncHook` lets `domains/migration` plug into the end
 *   of `domains/collections.syncCollections` so a Plex sync automatically
 *   refreshes Kometa/etc provider scans without `domains/collections`
 *   importing `domains/migration`.
 * - `setLocalCollectionsReader` lets `domains/users` walk collection
 *   labels (counting `User:<name>` markers) without importing
 *   `domains/collections` directly.
 */

type PostCollectionSyncHook = () => Promise<void> | void;

let postCollectionSyncHook: PostCollectionSyncHook = async () => {};

export function setPostCollectionSyncHook(next: PostCollectionSyncHook): void {
  postCollectionSyncHook = next;
}

export async function runPostCollectionSyncHook(): Promise<void> {
  await postCollectionSyncHook();
}

/**
 * Minimal collection shape consumers outside `domains/collections` need.
 * The full `CollectionRow` lives in the collections domain; this is the
 * subset that crosses the domain boundary.
 */
export interface LocalCollectionForReader {
  labels: string[];
}

type LocalCollectionsReader = () => { items: LocalCollectionForReader[] };

let localCollectionsReader: LocalCollectionsReader = () => ({ items: [] });

export function setLocalCollectionsReader(next: LocalCollectionsReader): void {
  localCollectionsReader = next;
}

export function readLocalCollections(): { items: LocalCollectionForReader[] } {
  return localCollectionsReader();
}

/**
 * `domains/notifications` records its own failed sends via this hook so
 * the failure shows up in the activity feed without notifications having
 * to import the events domain (which already imports notifications —
 * direct dependency would form a cycle).
 */
type EventEmitter = (type: string, message: string, metadata?: Record<string, unknown>) => void;

let eventEmitter: EventEmitter = () => {};

export function setEventEmitter(next: EventEmitter): void {
  eventEmitter = next;
}

export function emitEventViaHook(type: string, message: string, metadata?: Record<string, unknown>): void {
  eventEmitter(type, message, metadata);
}
