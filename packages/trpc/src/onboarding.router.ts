import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { isOnboardingStepId, type OnboardingStepId } from "@rube/domain.onboarding";
import { isValidTimezone } from "@rube/core";
import { buildPreset, planFromContext } from "@rube/contracts";
import { buildPlexAuthUrl, checkPlexPin, createPlexPin, getPlexAccount } from "@rube/plex";

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

/** How long a started Plex sign-in can be finished — plex.tv's own PIN lifetime. */
const PLEX_PIN_TTL_MS = 15 * 60_000;

export function createOnboardingRouter(deps: Pick<TrpcDeps, "config" | "jobs" | "onboarding" | "sessions">) {
  const { applyToUntouchedDefaults, restartSchedules, scheduleContext } = deps.jobs;
  const { setConfig } = deps.config;
  const { ensureAdminPlexClientId } = deps.sessions;

  /**
   * The one Plex sign-in in flight. The PIN id stays here rather than going to
   * the browser for the reason `handshake.ts` gives — plex.tv hands the token
   * to anyone who polls the id — and one slot is enough: there is one Plex
   * connection to set up, and starting again simply replaces it.
   */
  let pendingPin: { id: number; expiresAt: number } | null = null;
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
     * "Sign in with Plex" for the Plex token, so nobody has to dig one out of
     * an item's XML. The admin sign-in's PIN flow, but authenticated — before
     * admin auth is adopted that admits anyone who can reach setup at all,
     * which is the same set who could already paste a token — and redeemed
     * into `global_plex_token` rather than a session.
     */
    plexSignIn: procedure.mutation(async ({ ctx }) => {
      const clientId = ensureAdminPlexClientId();
      const pin = await createPlexPin(clientId);
      pendingPin = { id: pin.id, expiresAt: Date.now() + PLEX_PIN_TTL_MS };
      return { authUrl: buildPlexAuthUrl({ clientId, code: pin.code, forwardUrl: ctx.origin }) };
    }),

    /**
     * Finish it. The token is stored server-side and never returned: the
     * browser only learns whose account it was. A token from plex.tv's own
     * sign-in is valid by construction, so unlike a pasted one there is
     * nothing for a connection test to catch before storing it.
     */
    plexSignInPoll: procedure.mutation(async () => {
      if (!pendingPin || pendingPin.expiresAt < Date.now()) {
        pendingPin = null;
        return { status: "expired" as const };
      }
      const clientId = ensureAdminPlexClientId();
      const token = await checkPlexPin(pendingPin.id, clientId);
      if (!token) return { status: "pending" as const };
      pendingPin = null;
      const account = await getPlexAccount(token, clientId);
      setConfig("global_plex_token", token);
      return { status: "ok" as const, username: account.username };
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
      // The window alone used to be the whole recommendation, and it held the
      // shipped midnight syncs back onto `generate` every night. The jobs move
      // into it too — but only those still on their shipped time, so a user
      // who has already chosen a schedule keeps it.
      const ctx = scheduleContext();
      const moved = applyToUntouchedDefaults(
        buildPreset("recommended", ctx, planFromContext(ctx)),
        "Applied the recommended schedule during setup",
      );
      return { ok: true as const, moved };
    }),
  });

  return onboardingRouter;
}
