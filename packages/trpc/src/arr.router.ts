import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getQualityProfiles, getRootFolders, type ArrConfig, type ArrService } from "@tinkerbell/arr";
import { getConfig, errorMessage } from "@tinkerbell/core";
import { t, procedure } from "./_base.ts";

function configFor(service: ArrService): ArrConfig | null {
  if (service === "radarr") {
    const url = getConfig("global_radarr_url");
    const apiKey = getConfig("global_radarr_api_key");
    if (!url || !apiKey) return null;
    return { service, url, apiKey };
  }
  const url = getConfig("global_sonarr_url");
  const apiKey = getConfig("global_sonarr_api_key");
  if (!url || !apiKey) return null;
  return { service, url, apiKey };
}

const serviceInput = z.object({ service: z.enum(["radarr", "sonarr"]) });

export const arrRouter = t.router({
  status: procedure.query(() => {
    return {
      radarr: !!configFor("radarr"),
      sonarr: !!configFor("sonarr"),
    };
  }),

  qualityProfiles: procedure.input(serviceInput).query(async ({ input }) => {
    const cfg = configFor(input.service);
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
    const cfg = configFor(input.service);
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
