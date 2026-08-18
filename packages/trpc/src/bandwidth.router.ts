import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { DAY_MS, HOUR_MS } from "@tinkerbell/core";
import { MAX_TRANSFER_BYTES } from "@tinkerbell/domain.bandwidth";

import { t, procedure } from "./_base.ts";

/** The job that produces these rows. Starting one goes through `jobs.start`. */
const JOB_ID = "bandwidth-test";

export function createBandwidthRouter(deps: Pick<TrpcDeps, "bandwidth" | "jobs">) {
  const { getActiveRuns } = deps.jobs;
  const { bandwidth } = deps;
  const { getBandwidthHistory, getBandwidthSeries, getLatestBandwidthTest } = bandwidth;

  const bandwidthRouter = t.router({
    /**
     * The most recent successful test. `staleDays` is computed here so the tile
     * and the tool page agree on what "old" means without either doing date
     * arithmetic on a timestamp it might render in a different timezone.
     */
    latest: procedure.query(() => {
      const row = getLatestBandwidthTest();
      if (!row) return null;
      return { ...row, staleDays: Math.floor((Date.now() - row.startedAt) / DAY_MS) };
    }),

    history: procedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(90) }).optional())
      .query(({ input }) => getBandwidthHistory(Date.now() - (input?.days ?? 90) * DAY_MS)),

    /**
     * Live usage over the last `hours`, as `buckets` peaks — the Bandwidth
     * tile's sparkline. Peaks rather than averages: see the note on
     * `getBandwidthSeries`.
     */
    usage: procedure
      .input(
        z
          .object({
            hours: z.number().int().min(1).max(168).default(24),
            buckets: z.number().int().min(2).max(96).default(24),
          })
          .optional(),
      )
      .query(({ input }) => getBandwidthSeries(input?.buckets ?? 24, (input?.hours ?? 24) * HOUR_MS)),

    /** The live run, if one is in flight — what the tool page polls for progress. */
    activeRun: procedure.query(() => getActiveRuns().find((r) => r.jobId === JOB_ID) ?? null),

    /** Worst-case data moved by a run, so the UI can quote the cost before it starts. */
    maxTransferBytes: procedure.query(() => MAX_TRANSFER_BYTES),
  });

  return bandwidthRouter;
}
