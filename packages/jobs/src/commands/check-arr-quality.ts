/**
 * Compare every managed quality profile with its preset.
 *
 * Reports and never repairs. A profile that drifted gets a status, a list of
 * differences and (on the transition) an event, and the instance page offers
 * the re-apply with a preview. Silently re-applying would revert an edit the
 * user made on purpose in Radarr's own UI.
 *
 * Not checkpointed: it is six reads per instance with something managed on
 * it, and a rerun from the top costs less than the bookkeeping would.
 */

import { ServicesToken, type Services } from "@rube/composition";
import type { CommonJobConfig, JobContext } from "@rube/core";

export function createCheckArrQualityCommand(deps: Services) {
  const { quality } = deps.arrSettings;

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    ctx.log("rube check-arr-quality");
    const results = await quality.checkAll();
    if (results.length === 0) {
      ctx.log("No managed quality profiles. Apply a preset from an instance page to start.");
      return;
    }

    const failures: string[] = [];
    for (const r of results) {
      if (r.error) {
        ctx.log(`  ${r.instanceId}: ${r.error}`);
        failures.push(r.instanceId);
        continue;
      }
      const rows = quality.managed(r.instanceId);
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      ctx.log(`  ${r.instanceId}: ${[...counts].map(([status, n]) => `${n} ${status.replace("_", " ")}`).join(", ")}`);
    }

    // As in `sync-arr`: only every instance failing is a failed run.
    if (failures.length === results.length) {
      throw new Error(`Every instance failed: ${failures.join(", ")}`);
    }
  }

  return { run };
}

export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createCheckArrQualityCommand>["run"]>[1],
): Promise<void> {
  return createCheckArrQualityCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
