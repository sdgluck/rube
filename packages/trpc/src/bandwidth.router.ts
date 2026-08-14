import { z } from "zod";
import { DAY_MS } from "@tinkerbell/core";
import { getBandwidthHistory, getLatestBandwidthTest, MAX_TRANSFER_BYTES } from "@tinkerbell/domain.bandwidth";
import { getActiveRuns } from "@tinkerbell/jobs";
import { t, procedure } from "./_base.ts";

/** The job that produces these rows. Starting one goes through `jobs.start`. */
const JOB_ID = "bandwidth-test";

export const bandwidthRouter = t.router({
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

  /** The live run, if one is in flight — what the tool page polls for progress. */
  activeRun: procedure.query(() => getActiveRuns().find((r) => r.jobId === JOB_ID) ?? null),

  /** Worst-case data moved by a run, so the UI can quote the cost before it starts. */
  maxTransferBytes: procedure.query(() => MAX_TRANSFER_BYTES),
});
