import { TRPCError } from "@trpc/server";
import { getConfig } from "@tinkerbell/core";
import { startJob } from "@tinkerbell/jobs";
import { t, procedure } from "./_base.ts";

const ENABLE_JOB = "personalize-enable";
const DISABLE_JOB = "personalize-disable";

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
