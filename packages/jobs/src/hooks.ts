/**
 * Wire the side-effect hooks that let a lower-level module call a higher-level
 * one without an import cycle.
 *
 * These used to be registered only in `apps/server`'s boot, and the omission was
 * invisible: every hook's default is a no-op, so nothing throws, nothing logs,
 * and the effect simply doesn't happen. But commands execute in **Sidequest
 * worker threads** — a separate module graph, where `apps/server` never runs —
 * and the jobs are where nearly all of this actually gets used:
 *
 * - `setEventEmitter`: `domains/notifications` records why a notification was
 *   suppressed, and that a send failed, through this hook. Almost every
 *   notification originates in a job, so the whole point of the routing-table
 *   work — being able to tell a phone that stayed silent by design from a webhook
 *   URL that has rotted — was lost exactly where it mattered.
 * - `setHealthReporter`: every client core builds forwards health through this.
 *   Plex going away *during* a nightly job is the moment you would most want on
 *   the failure streak, and it contributed nothing.
 * - `setPostCollectionSyncHook`: `syncCollections` calls it to refresh the
 *   migration providers' scans — and `syncCollections` runs in a worker.
 * - `setLocalCollectionsReader`: `domains/users` counts `User:<name>` collection
 *   labels through it, which `personalize` and `because-you-watched` rely on.
 *
 * Idempotent, and cheap: registering twice just re-assigns the same functions,
 * so both entry points can call it without coordinating.
 */
import {
  setEventEmitter,
  setHealthReporter,
  setLocalCollectionsReader,
  setPostCollectionSyncHook,
} from "@tinkerbell/core";
import { getLocalCollections } from "@tinkerbell/domain.collections";
import { emitEvent } from "@tinkerbell/domain.events";
import { reportHealth } from "@tinkerbell/domain.health";
import { scanAllProviders } from "@tinkerbell/domain.migration";

export function registerCoreHooks(): void {
  setHealthReporter(reportHealth);
  setEventEmitter(emitEvent);
  setPostCollectionSyncHook(scanAllProviders);
  setLocalCollectionsReader(() => getLocalCollections());
}
