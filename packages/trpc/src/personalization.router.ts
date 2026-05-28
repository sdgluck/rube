import { TRPCError } from "@trpc/server";
import { inArray, sql } from "drizzle-orm";
import { getConfig } from "@tinkerbell/core";
import { db, mediaItems } from "@tinkerbell/db";
import { startJob } from "@tinkerbell/jobs";
import { t, procedure } from "./_base.ts";

const ENABLE_JOB = "personalize-enable";
const DISABLE_JOB = "personalize-disable";

// Labelling phase runs Plex PUTs at concurrency 10; ~25 items/sec is a
// conservative steady-state we've observed against a healthy server.
const ITEMS_PER_SECOND = 25;
// Snapshot + sharing-restriction phases scale with user count but the
// labelling phase dominates; add a flat baseline for setup overhead.
const BASELINE_SECONDS = 30;

async function start(jobId: string): Promise<{ runId: string }> {
  const result = await startJob(jobId);
  if (!result) {
    throw new TRPCError({ code: "CONFLICT", message: `${jobId} is already running` });
  }
  return { runId: result.runId };
}

export const personalizationRouter = t.router({
  status: procedure.query(() => {
    return getConfig("global_personalized_sharing") ?? { status: "disabled" as const };
  }),

  estimate: procedure.query(() => {
    const libraries = getConfig("global_plex_libraries");
    const base = db.select({ count: sql<number>`count(*)` }).from(mediaItems);
    const itemCount =
      libraries && libraries.length > 0
        ? (base.where(inArray(mediaItems.sectionTitle, libraries)).get()?.count ?? 0)
        : (base.get()?.count ?? 0);
    const estimatedSeconds = Math.ceil(itemCount / ITEMS_PER_SECOND) + BASELINE_SECONDS;
    return { itemCount, estimatedSeconds };
  }),

  enable: procedure.mutation(async () => {
    const status = getConfig("global_personalized_sharing")?.status ?? "disabled";
    if (status === "disabling") {
      throw new TRPCError({ code: "CONFLICT", message: "Personalization is currently being disabled." });
    }
    return start(ENABLE_JOB);
  }),

  disable: procedure.mutation(async () => {
    const status = getConfig("global_personalized_sharing")?.status ?? "disabled";
    if (status === "enabling") {
      throw new TRPCError({ code: "CONFLICT", message: "Personalization is currently being enabled." });
    }
    return start(DISABLE_JOB);
  }),

  // Re-apply restrictions to any newly-shared users (idempotent enable run).
  reconcile: procedure.mutation(async () => {
    const status = getConfig("global_personalized_sharing")?.status ?? "disabled";
    if (status !== "enabled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Personalization is not enabled." });
    }
    return start(ENABLE_JOB);
  }),
});
