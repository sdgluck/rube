import { z } from "zod";
import { getQualityProfiles, getRootFolders, type ArrConfig, type ArrService } from "@tinkerbell/arr";
import { getConfig } from "../lib/config.ts";
import { errorMessage } from "../lib/util.ts";
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
    if (!cfg) return { ok: false as const, error: `${input.service} is not configured`, profiles: [] };
    try {
      const profiles = await getQualityProfiles(cfg);
      return { ok: true as const, profiles };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err), profiles: [] };
    }
  }),

  rootFolders: procedure.input(serviceInput).query(async ({ input }) => {
    const cfg = configFor(input.service);
    if (!cfg) return { ok: false as const, error: `${input.service} is not configured`, folders: [] };
    try {
      const folders = await getRootFolders(cfg);
      return { ok: true as const, folders };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err), folders: [] };
    }
  }),
});
