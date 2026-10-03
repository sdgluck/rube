/**
 * Quality profile presets: preview, apply, check, undo.
 *
 * `plan` is a mutation although it writes nothing. It makes six reads against
 * the instance, and as a query TanStack would refire it on mount and on every
 * window focus, re-reading somebody's Radarr each time they alt-tab back to
 * look at the preview. Same reasoning as interactive search.
 *
 * Errors keep their meaning over the wire. A `PlanError` is the user's to fix
 * (412). A stale preview is a conflict (409), and the UI answers it by
 * re-planning. Only a failure of the *Arr itself is a 502.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sizeLimitSchema } from "@tinkerbell/contracts";
import { ApplyError, PlanConflictError, PlanError } from "@tinkerbell/domain.arr-settings";
import type { TrpcDeps } from "../deps.ts";
import { t, procedure } from "../_base.ts";
import { upstream } from "./_shared.ts";

const planInput = z.object({
  instanceId: z.string(),
  presetId: z.string(),
  limit: sizeLimitSchema,
  target: z.union([z.object({ profileId: z.number().int() }), z.object({ name: z.string().min(1).max(100) })]),
});

/** Map the domain's errors before `upstream` turns everything into a 502. */
async function settled<T>(fn: () => Promise<T>): Promise<T> {
  return upstream(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PlanError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      if (err instanceof PlanConflictError) throw new TRPCError({ code: "CONFLICT", message: err.message });
      // The snapshot is the newest in `snapshots`, which is where the UI
      // offers the restore after a failed apply.
      if (err instanceof ApplyError) throw new TRPCError({ code: "BAD_GATEWAY", message: err.message });
      throw err;
    }
  });
}

export function createArrQualityRouter(deps: Pick<TrpcDeps, "arrSettings">) {
  const quality = deps.arrSettings.quality;

  return t.router({
    presets: procedure
      .input(z.object({ instanceId: z.string() }))
      .query(({ input }) => settled(() => quality.presets(input.instanceId))),

    profiles: procedure
      .input(z.object({ instanceId: z.string() }))
      .query(({ input }) => settled(() => quality.profiles(input.instanceId))),

    /** Managed rows across every instance: what the nav badge and the instance cards need. */
    managed: procedure.input(z.object({ instanceId: z.string().optional() }).optional()).query(({ input }) =>
      quality.managed(input?.instanceId).map((r) => ({
        id: r.id,
        instanceId: r.instanceId,
        profileName: r.profileName,
        presetId: r.presetId,
        status: r.status,
        checkedAt: r.checkedAt,
      })),
    ),

    plan: procedure.input(planInput).mutation(({ input }) => settled(() => quality.plan(input))),

    // Not `apply`: tRPC reserves it, since a router is a callable proxy.
    applyPreset: procedure
      .input(planInput.extend({ fingerprint: z.string() }))
      .mutation(({ input }) => settled(() => quality.apply(input))),

    detach: procedure
      .input(z.object({ managedId: z.string() }))
      .mutation(({ input }) => ({ ok: quality.detach(input.managedId) })),

    checkDrift: procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(({ input }) => settled(() => quality.checkInstance(input.instanceId))),

    snapshots: procedure
      .input(z.object({ instanceId: z.string() }))
      .query(({ input }) => quality.snapshots(input.instanceId)),

    restore: procedure
      .input(z.object({ snapshotId: z.string() }))
      .mutation(({ input }) => settled(() => quality.restore(input.snapshotId))),
  });
}
