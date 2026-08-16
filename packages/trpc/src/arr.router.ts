import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getQualityProfiles, getRootFolders, type ArrConfig, type ArrService } from "@tinkerbell/arr";
import { arrInstances, errorMessage, resolveArrInstance } from "@tinkerbell/core";
import { t, procedure } from "./_base.ts";

/**
 * The instance to talk to. An absent id means the service's default — the
 * server the original `global_*` keys point at.
 */
function configFor(service: ArrService, instanceId?: string): ArrConfig | null {
  const instance = resolveArrInstance(service, instanceId);
  if (!instance) return null;
  return { service, url: instance.url, apiKey: instance.apiKey };
}

const serviceInput = z.object({
  service: z.enum(["radarr", "sonarr"]),
  instanceId: z.string().optional(),
});

export const arrRouter = t.router({
  status: procedure.query(() => {
    return {
      radarr: !!configFor("radarr"),
      sonarr: !!configFor("sonarr"),
    };
  }),

  /**
   * Every configured instance, default first.
   *
   * Credentials are deliberately not returned: this feeds pickers, which need
   * a name and an id and nothing else.
   */
  instances: procedure.query(() =>
    arrInstances().map((i) => ({ id: i.id, service: i.service, name: i.name, isDefault: i.isDefault })),
  ),

  qualityProfiles: procedure.input(serviceInput).query(async ({ input }) => {
    const cfg = configFor(input.service, input.instanceId);
    if (!cfg) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${input.service} is not configured`,
      });
    }
    try {
      return await getQualityProfiles(cfg);
    } catch (err) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: errorMessage(err) });
    }
  }),

  rootFolders: procedure.input(serviceInput).query(async ({ input }) => {
    const cfg = configFor(input.service, input.instanceId);
    if (!cfg) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${input.service} is not configured`,
      });
    }
    try {
      return await getRootFolders(cfg);
    } catch (err) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: errorMessage(err) });
    }
  }),
});
