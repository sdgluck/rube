import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getQualityProfiles, getRootFolders, type ArrConfig, type ArrService } from "@tinkerbell/arr";
import { errorMessage } from "@tinkerbell/core";
import { t, procedure } from "./_base.ts";
import { createArrLibraryRouter } from "./arr/library.router.ts";
import { createArrActivityRouter } from "./arr/activity.router.ts";

const serviceInput = z.object({
  service: z.enum(["radarr", "sonarr"]),
  instanceId: z.string().optional(),
});

export function createArrRouter(deps: Pick<TrpcDeps, "arr" | "arrLibrary" | "arrActivity">) {
  const { arr } = deps;
  const { arrInstances, resolveArrInstance } = arr;

  /**
   * The instance to talk to. An absent id means the service's default — the
   * server the original `global_*` keys point at.
   */
  function configFor(service: ArrService, instanceId?: string): ArrConfig | null {
    const instance = resolveArrInstance(service, instanceId);
    if (!instance) return null;
    return { service, url: instance.url, apiKey: instance.apiKey };
  }

  const arrRouter = t.router({
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

    /**
     * The management surface, nested rather than added as sibling routers.
     *
     * `arr.status`, `arr.instances`, `arr.qualityProfiles` and `arr.rootFolders`
     * above are unchanged and keep their paths — they are called from the rule
     * wizard and the settings pages, and moving them would be a breaking change
     * for no benefit.
     */
    library: createArrLibraryRouter(deps),
    activity: createArrActivityRouter(deps),
  });

  return arrRouter;
}
