/**
 * The *Arr action between a saved rule's `config.arr` and the wizard's form.
 *
 * Its own module because the saved shape changed: a rule used to carry one
 * target (instance, profile, folder) that was applied to Radarr and Sonarr
 * alike, so a mixed list sent its shows to Sonarr under a Radarr profile id.
 * Reading that shape back puts the target under the one service the wizard
 * showed at the time, and saving always writes one target per service.
 */
import { arrTargetFor, type ArrService, type RuleConfig } from "@tinkerbell/contracts";
import { arrServiceForType } from "./rule-types.ts";
import { DEFAULT_ARR_FORM, DEFAULT_ARR_TARGET, type ArrFormState, type ArrTargetForm } from "./types.ts";

type ArrConfig = NonNullable<RuleConfig["arr"]>;

export function arrFormFromConfig(arr: ArrConfig | undefined, type: string, chart: string): ArrFormState {
  if (!arr) return { ...DEFAULT_ARR_FORM };
  const legacy = arrServiceForType(type, chart);
  const target = (svc: ArrService): ArrTargetForm => {
    const t = arrTargetFor(arr, svc, legacy);
    return t
      ? { instanceId: t.instanceId ?? "", qualityProfileId: t.qualityProfileId, rootFolderPath: t.rootFolderPath }
      : { ...DEFAULT_ARR_TARGET };
  };
  return {
    enabled: arr.enabled,
    // Replaced from the rule's sections as soon as the wizard has loaded them.
    services: (["radarr", "sonarr"] as const).filter((svc) => !!arrTargetFor(arr, svc, legacy)),
    radarr: target("radarr"),
    sonarr: target("sonarr"),
    monitor: arr.monitor,
    searchOnAdd: arr.searchOnAdd,
    maxAddsPerRun: arr.maxAddsPerRun,
    dryRun: arr.dryRun,
  };
}

/** Only the services in scope are written; a target for a library the rule no longer covers is dropped. */
export function arrConfigFromForm(arr: ArrFormState): ArrConfig | undefined {
  if (!arr.enabled) return undefined;
  const out: ArrConfig = {
    enabled: true,
    monitor: arr.monitor,
    searchOnAdd: arr.searchOnAdd,
    maxAddsPerRun: arr.maxAddsPerRun,
    dryRun: arr.dryRun,
  };
  for (const svc of arr.services) {
    const { instanceId, qualityProfileId, rootFolderPath } = arr[svc];
    out[svc] = { ...(instanceId ? { instanceId } : {}), qualityProfileId, rootFolderPath };
  }
  return out;
}
