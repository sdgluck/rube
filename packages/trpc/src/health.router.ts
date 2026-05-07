import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { errorMessage, getAllConfig } from "@tinkerbell/core";
import {
  reportHealth,
  getHealthLatest,
  getHealthHistory,
  HEALTH_SERVICES,
  checkServiceHealth,
} from "@tinkerbell/domain.health";
import { t, procedure } from "./_base.ts";

export const healthRouter = t.router({
  status: procedure.query(() => {
    const serviceNames = HEALTH_SERVICES.map((s) => s.service);
    const entries = getHealthLatest(serviceNames);
    const cfg = getAllConfig();

    return HEALTH_SERVICES.map((svc) => {
      const entry = entries.find((e) => e.service === svc.service);
      return {
        service: svc.service,
        configured: svc.configuredFn(cfg),
        status: entry?.status ?? null,
        message: entry?.message ?? null,
        timestamp: entry?.timestamp ?? null,
      };
    });
  }),

  history: procedure.input(z.object({ hours: z.number().default(24) })).query(({ input }) => {
    const since = Date.now() - input.hours * 60 * 60 * 1000;
    const result: Record<string, Array<{ status: string; timestamp: number }>> = {};
    for (const svc of HEALTH_SERVICES) {
      result[svc.service] = getHealthHistory(svc.service, since);
    }
    return result;
  }),

  check: procedure.input(z.object({ service: z.string() })).mutation(async ({ input }) => {
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
