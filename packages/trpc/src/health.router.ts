import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { errorMessage } from "@rube/core";

import { t, procedure } from "./_base.ts";
import { NativeAdmin } from "@rube/contracts/native-api";

/** A mute in the past has already lapsed and is reported as absent. */
function mutedUntilFor(until: number | undefined): number | null {
  return until && until > Date.now() ? until : null;
}

export function createHealthRouter(deps: Pick<TrpcDeps, "config" | "health">) {
  const { config, health } = deps;
  const { getAllConfig, getConfig, setConfig } = config;
  const { reportHealth, getHealthLatest, getHealthHistory, healthServices, checkServiceHealth } = health;

  const healthRouter = t.router({
    status: procedure.output(NativeAdmin.HealthStatusOutput).query(() => {
      const services = healthServices();
      const serviceNames = services.map((s) => s.service);
      const entries = getHealthLatest(serviceNames);
      const cfg = getAllConfig();
      const mutes = getConfig("health_mutes") ?? {};

      return services.map((svc) => {
        const entry = entries.find((e) => e.service === svc.service);
        return {
          service: svc.service,
          configured: svc.configuredFn(cfg),
          status: entry?.status ?? null,
          message: entry?.message ?? null,
          timestamp: entry?.timestamp ?? null,
          // An expired mute is no mute. Resolved here rather than in the
          // browser so the page and the dispatcher agree about what is quiet.
          mutedUntil: mutedUntilFor(mutes[svc.service]),
        };
      });
    }),

    history: procedure.input(z.object({ hours: z.number().default(24) })).query(({ input }) => {
      const since = Date.now() - input.hours * 60 * 60 * 1000;
      const result: Record<string, Array<{ status: string; timestamp: number }>> = {};
      for (const svc of healthServices()) {
        result[svc.service] = getHealthHistory(svc.service, since);
      }
      return result;
    }),

    /**
     * Silence one service for a while.
     *
     * An expiry rather than a flag: the mute exists for the service you already
     * know is broken and are in the middle of fixing, and a mute that had to be
     * turned off by hand would be left on — which is the failure that makes
     * people stop trusting health checks altogether. `hours: 0` lifts it.
     */
    mute: procedure
      .input(
        z.object({
          service: z.string(),
          hours: z
            .number()
            .min(0)
            .max(24 * 30),
        }),
      )
      .mutation(({ input }) => {
        const mutes = { ...getConfig("health_mutes") };
        if (input.hours === 0) delete mutes[input.service];
        else mutes[input.service] = Date.now() + input.hours * 60 * 60 * 1000;
        setConfig("health_mutes", mutes);
        return { ok: true };
      }),

    check: procedure
      .input(z.object({ service: z.string() }))
      .output(NativeAdmin.HealthCheckOutput)
      .mutation(async ({ input }) => {
        // Checked against the live service list before anything is recorded. An
        // unknown name used to throw "Unknown service" from `checkServiceHealth` and
        // then be *written as a failing health row for it* — so a caller could
        // invent a service, and a second call would announce `health.failed` for
        // something that does not exist.
        if (!healthServices().some((s) => s.service === input.service)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown service: ${input.service}` });
        }
        try {
          await checkServiceHealth(input.service);
          return { ok: true };
        } catch (err) {
          const message = errorMessage(err);
          reportHealth(input.service, "error", message);
          throw new TRPCError({ code: "BAD_GATEWAY", message });
        }
      }),
  });

  return healthRouter;
}
