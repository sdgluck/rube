import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { isOnboardingStepId, type OnboardingStepId } from "@tinkerbell/domain.onboarding";
import { isValidTimezone } from "@tinkerbell/core";

import { t, procedure } from "./_base.ts";

/**
 * Narrow verbs rather than a generic key writer.
 *
 * Setup state could ride on `config.save` — it is one config key — but the
 * only thing a client ever wants to say about it is "I'm on this step" or
 * "I've decided to skip this", and the derivation that answers "how far along
 * am I" has to happen server-side against live config anyway. Naming the verbs
 * keeps the client from having to know the shape of the stored state at all.
 */
const stepInput = z.object({
  stepId: z.string().refine(isOnboardingStepId, "Unknown onboarding step"),
});

function asStepId(value: string): OnboardingStepId {
  // The refine above has already vouched for this; the cast is the type-level
  // half of the same check.
  return value as OnboardingStepId;
}

export function createOnboardingRouter(deps: Pick<TrpcDeps, "jobs" | "onboarding">) {
  const { restartSchedules } = deps.jobs;
  const { onboarding } = deps;
  const {
    acknowledgeStep,
    applyScheduleDefaults,
    completeOnboarding,
    dismissOnboarding,
    getOnboardingStatus,
    resetOnboarding,
    setOnboardingStep,
    skipOnboarding,
    startOnboarding,
  } = onboarding;

  const onboardingRouter = t.router({
    status: procedure.query(() => getOnboardingStatus()),

    start: procedure.mutation(() => {
      startOnboarding();
      return { ok: true as const };
    }),

    setStep: procedure.input(stepInput).mutation(({ input }) => {
      setOnboardingStep(asStepId(input.stepId));
      return { ok: true as const };
    }),

    acknowledge: procedure.input(stepInput).mutation(({ input }) => {
      try {
        acknowledgeStep(asStepId(input.stepId));
      } catch (err) {
        // Only ever thrown for a step that can't be skipped (Plex), which is a
        // client asking for something the flow doesn't offer, not a server fault.
        throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
      }
      return { ok: true as const };
    }),

    skip: procedure.mutation(() => {
      skipOnboarding();
      return { ok: true as const };
    }),

    dismiss: procedure.mutation(() => {
      dismissOnboarding();
      return { ok: true as const };
    }),

    complete: procedure.mutation(() => {
      completeOnboarding();
      return { ok: true as const };
    }),

    reset: procedure.mutation(() => {
      resetOnboarding();
      return { ok: true as const };
    }),

    /**
     * The Schedule step's "Use recommended" button. Three config keys in one
     * call, and the same timezone validation `config.save` does — croner throws
     * when it builds against an unknown zone, and that throw would land inside
     * `initJobs` at next boot with no UI left to fix it from.
     */
    applyScheduleDefaults: procedure.input(z.object({ timezone: z.string().min(1) })).mutation(({ input }) => {
      if (!isValidTimezone(input.timezone)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${input.timezone}" is not a known timezone. Use an IANA name such as "Europe/London" or "UTC".`,
        });
      }
      applyScheduleDefaults(input.timezone);
      // The live Cron objects bake their zone in at construction, so they keep
      // evaluating against the old one until restarted.
      restartSchedules();
      return { ok: true as const };
    }),
  });

  return onboardingRouter;
}
