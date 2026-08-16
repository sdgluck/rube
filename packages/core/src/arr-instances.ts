/**
 * Which Radarr/Sonarr a piece of work should talk to.
 *
 * There used to be exactly one of each, held in `global_radarr_url` and its
 * three siblings. A split 4K instance is the norm in this community — a
 * second Radarr with its own root folders and quality profiles, often a third
 * for anime — and one pair per service could not express it: a cleanup rule
 * could not delete from the right instance, and auto-add could not target one.
 *
 * The fix is additive on purpose. The original keys are untouched and become
 * the *default* instance of their service, so nothing has to be migrated, and
 * a rule that names no instance resolves to exactly the server it has always
 * used. An install that never wants a second instance never sees one.
 */
import { getConfig } from "./config.ts";

export type ArrServiceName = "radarr" | "sonarr";

export interface ArrInstance {
  id: string;
  service: ArrServiceName;
  name: string;
  url: string;
  apiKey: string;
  /** True for the instance backed by the original `global_*` keys. */
  isDefault: boolean;
}

/**
 * The ids of the two original instances.
 *
 * Fixed strings rather than generated: a rule saved before this existed
 * carries no instance id at all and must resolve to the default, and a
 * default whose id changed between restarts would break every rule that had
 * since named it explicitly.
 */
export const DEFAULT_ARR_IDS: Record<ArrServiceName, string> = {
  radarr: "radarr",
  sonarr: "sonarr",
};

function defaultInstance(service: ArrServiceName): ArrInstance | null {
  const url = service === "radarr" ? getConfig("global_radarr_url") : getConfig("global_sonarr_url");
  const apiKey = service === "radarr" ? getConfig("global_radarr_api_key") : getConfig("global_sonarr_api_key");
  if (!url || !apiKey) return null;
  return {
    id: DEFAULT_ARR_IDS[service],
    service,
    name: service === "radarr" ? "Radarr" : "Sonarr",
    url,
    apiKey,
    isDefault: true,
  };
}

/**
 * Every configured instance, default first.
 *
 * Default first because it is the one an unqualified rule means, so a picker
 * listing them in this order has the status quo at the top.
 */
export function arrInstances(service?: ArrServiceName): ArrInstance[] {
  const services: ArrServiceName[] = service ? [service] : ["radarr", "sonarr"];
  const extra = getConfig("global_arr_instances") ?? [];

  const out: ArrInstance[] = [];
  for (const svc of services) {
    const base = defaultInstance(svc);
    if (base) out.push(base);
    for (const inst of extra) {
      if (inst.service !== svc) continue;
      if (!inst.url || !inst.apiKey) continue;
      // A configured instance colliding with a reserved default id would
      // shadow the original server, which is the one thing that must keep
      // working untouched.
      if (inst.id === DEFAULT_ARR_IDS[svc]) continue;
      out.push({ ...inst, isDefault: false });
    }
  }
  return out;
}

/**
 * Resolve the instance a rule means.
 *
 * An absent or unknown id falls back to the service's default rather than
 * failing. Unknown is the case that matters: an instance can be deleted while
 * rules still name it, and refusing to run is a worse answer than doing what
 * the rule did before the instance existed — the rule still names a server
 * that is configured, and the run log says which one it used.
 */
export function resolveArrInstance(service: ArrServiceName, instanceId?: string | null): ArrInstance | null {
  const all = arrInstances(service);
  if (instanceId) {
    const found = all.find((i) => i.id === instanceId);
    if (found) return found;
  }
  return all.find((i) => i.isDefault) ?? all[0] ?? null;
}
