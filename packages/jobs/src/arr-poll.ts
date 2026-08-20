/**
 * How much is downloading, right now.
 *
 * The queue is never mirrored — a stored copy of it is wrong within seconds —
 * but the *count* has to be available without a network call, because the nav
 * badge renders on every page load and fanning out to four *Arrs there would
 * make one unreachable box feel like a broken app.
 *
 * So: a cheap poll writes the number into `arr_sync_state`, and everything
 * that only needs "how many" reads it from there. Anything that needs the
 * actual queue still proxies live.
 */

import { ServicesToken } from "@tinkerbell/composition";
import type { JobContext } from "@tinkerbell/core";
import { createRadarrClient } from "@tinkerbell/radarr";
import { createSonarrClient } from "@tinkerbell/sonarr";

export async function pollArrQueues(ctx: JobContext): Promise<string> {
  const { arr, arrLibrary } = ctx.scope.resolve(ServicesToken);
  const instances = arr.arrInstances();
  if (instances.length === 0) return "No media managers configured.";

  let total = 0;
  let failed = 0;

  for (const instance of instances) {
    try {
      const client =
        instance.service === "radarr"
          ? createRadarrClient({ url: instance.url, apiKey: instance.apiKey, signal: ctx.signal })
          : createSonarrClient({ url: instance.url, apiKey: instance.apiKey, signal: ctx.signal });

      const status = await client.queueStatus();
      const count = status?.totalCount ?? status?.count ?? 0;
      total += count;
      arrLibrary.recordState(instance.id, instance.service, { queueCount: count });
    } catch {
      // An unreachable instance is already reported by the sync and by the
      // health check. A poll that runs every minute must not add a third voice
      // saying the same thing — it would drown the activity feed.
      failed++;
    }
  }

  // Stable text when nothing is happening, so `quiet` can actually suppress it.
  if (total === 0 && failed === 0) return "Nothing downloading.";
  const parts = [`${total} item(s) downloading`];
  if (failed > 0) parts.push(`${failed} instance(s) unreachable`);
  return `${parts.join(", ")}.`;
}
