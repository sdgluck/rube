/**
 * Pull every configured Radarr and Sonarr into the mirror.
 *
 * A Sidequest command rather than an internal job, for the same reasons
 * `sync-media` is one: it is network-heavy, legitimately long on a large
 * install, must be cancellable through `ctx.signal`, and belongs in the Jobs
 * UI with progress and a run log.
 *
 * The checkpoint is per **instance**, which is as fine-grained as this can
 * usefully get — a library fetch is a single unpaged request, so there is no
 * seam inside one to resume from.
 */

import { ServicesToken, type Services } from "@tinkerbell/composition";
import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

interface SyncArrCheckpoint {
  /** The instance list at the time — a different one invalidates the checkpoint. */
  instanceIds: string[];
  completedInstanceIds: string[];
}

function sameInstances(saved: string[], current: { id: string }[]): boolean {
  if (saved.length !== current.length) return false;
  const ids = new Set(current.map((i) => i.id));
  return saved.every((id) => ids.has(id));
}

export function createSyncArrCommand(deps: Services) {
  const { arr, arrLibrary, arrActivity } = deps;
  const { arrInstances } = arr;

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    const instances = arrInstances();
    if (instances.length === 0) {
      ctx.log("No Radarr or Sonarr is configured — nothing to sync.");
      return;
    }

    ctx.log(`tinkerbell sync-arr`);
    ctx.log(`${instances.length} instance(s) configured.`);

    const saved = ctx.checkpoint.read<SyncArrCheckpoint>();
    const resumable = saved && sameInstances(saved.instanceIds, instances);
    if (saved && !resumable) {
      ctx.log("The instance list changed since the last run — starting from scratch.");
    }
    const completed = resumable ? [...saved.completedInstanceIds] : [];
    if (completed.length > 0) {
      ctx.log(`Resuming: skipping ${completed.length} instance(s) completed in the previous run.`);
    }

    let synced = 0;
    let tombstoned = 0;
    const failures: string[] = [];

    for (const instance of instances) {
      if (completed.includes(instance.id)) continue;
      ctx.log(`${instance.name} (${instance.service})…`);

      const result = await arrLibrary.syncInstance(instance, {
        signal: ctx.signal,
        onProgress: (done, total) => ctx.progress(done, total, instance.name),
      });

      if (result.error) {
        // One box being down must not cost the others their sync. The error is
        // already recorded on `arr_sync_state` and reported to health; here it
        // only needs to be visible in the run log and counted at the end.
        ctx.log(`  ${instance.name}: ${result.error}`);
        failures.push(`${instance.name}: ${result.error}`);
        continue;
      }

      synced += result.synced;
      tombstoned += result.tombstoned;
      ctx.log(`  ${result.synced} item(s), ${result.tombstoned} no longer present.`);

      // History rides on the same pass. It is incremental — `/history/since`
      // from the stored watermark — so it costs one small request per instance
      // rather than anything proportional to the library.
      const state = arrLibrary.instanceState([instance.id])[0];
      const ingest = await arrActivity.ingest(instance, state?.historyWatermark ?? 0, { signal: ctx.signal });
      if (ingest.error) {
        ctx.log(`  history: ${ingest.error}`);
      } else if (ingest.ingested > 0) {
        arrLibrary.recordState(instance.id, instance.service, { historyWatermark: ingest.watermark });
        ctx.log(`  ${ingest.ingested} new history event(s).`);
      }

      completed.push(instance.id);
      ctx.checkpoint.write({
        instanceIds: instances.map((i) => i.id),
        completedInstanceIds: completed,
      } satisfies SyncArrCheckpoint);
    }

    ctx.checkpoint.clear();
    ctx.log(`Done! ${synced} item(s) synced, ${tombstoned} tombstoned.`);

    // The run only fails if *every* instance failed. A partial success is a
    // partial success, and marking it red would train people to ignore the
    // colour on any install where one box is flaky.
    if (failures.length === instances.length) {
      throw new Error(`Every instance failed: ${failures.join("; ")}`);
    }
    if (failures.length > 0) {
      ctx.log(`${failures.length} instance(s) failed and will be retried next run.`);
    }
  }

  return { run };
}

export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createSyncArrCommand>["run"]>[1],
): Promise<void> {
  return createSyncArrCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
