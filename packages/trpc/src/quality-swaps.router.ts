import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { arrQualityProfiles } from "@tinkerbell/db";

import { t, procedure } from "./_base.ts";

/**
 * Unused 4K: the candidates, the swaps in progress, and starting or stopping
 * one. The work itself happens in the `quality-swaps` job — `start` only
 * records intent and nudges the job so the first search doesn't wait five
 * minutes for the schedule.
 */
export function createQualitySwapsRouter(deps: Pick<TrpcDeps, "qualitySwaps" | "playback" | "arr" | "db" | "jobs">) {
  const { qualitySwaps, playback, arr, db } = deps;
  const { startJob } = deps.jobs;

  return t.router({
    candidates: procedure.query(() => ({
      items: qualitySwaps.unusedFourK(),
      // How far back the play log reaches — the page says so, because a film
      // played in 4K before then is invisible to the check.
      coverage: playback.watchHistoryCoverage(),
    })),

    /**
     * Each Radarr's quality profiles, from the mirror, for the "swap to"
     * picker. Profiles with "1080" in the name sort first: it is the one
     * nearly everybody means, and a wrong pick here is a 4K re-download.
     */
    profiles: procedure.query(() =>
      arr.arrInstances("radarr").map((instance) => ({
        instanceId: instance.id,
        instanceName: instance.name,
        profiles: db
          .select({ id: arrQualityProfiles.arrId, name: arrQualityProfiles.name })
          .from(arrQualityProfiles)
          .where(eq(arrQualityProfiles.instanceId, instance.id))
          .all()
          .sort((a, b) => Number(/1080/.test(b.name)) - Number(/1080/.test(a.name)) || a.name.localeCompare(b.name)),
      })),
    ),

    swaps: procedure.query(() => qualitySwaps.listSwaps()),

    start: procedure
      .input(
        z.object({
          movies: z
            .array(z.object({ instanceId: z.string(), arrMovieId: z.number().int() }))
            .min(1)
            .max(500),
          profiles: z.record(z.string(), z.number().int()),
        }),
      )
      .mutation(async ({ input }) => {
        const result = qualitySwaps.start(input);
        if (result.queued > 0) await startJob("quality-swaps").catch(() => {});
        return result;
      }),

    cancel: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => qualitySwaps.cancel(input.id)),
  });
}
