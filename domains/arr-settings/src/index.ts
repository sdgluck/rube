/* ─── The *Arrs' own settings, written by Rube ───────────────────────
 *
 * The first area is quality profiles, driven by curated presets with user-set
 * size limits.
 *
 * Distinct from `arr-library`, which mirrors what the *Arrs hold and never
 * writes their configuration. Everything here writes configuration, so
 * everything here goes through a plan the user has seen and leaves a snapshot
 * behind.
 */

import { token } from "@rube/container";
import type { Db } from "@rube/db";
import type { ArrInstance, ArrInstances } from "@rube/core";
import type { ChangeRecorder, Clock, EventBus } from "@rube/ports";
import { createQualityService } from "./quality/service.ts";
import type { ArrClient } from "./quality/live.ts";
import type { QualityApi } from "./quality/wire.ts";

export interface ArrSettingsDeps {
  db: Db;
  arr: ArrInstances;
  refreshConfigMirror: (instance: ArrInstance, client: ArrClient) => Promise<void>;
  recordChange: ChangeRecorder;
  emitEvent: EventBus;
  now: Clock;
  connect?: (instance: ArrInstance) => { client: ArrClient; api: QualityApi };
}

export function createArrSettings(deps: ArrSettingsDeps) {
  return {
    quality: createQualityService(deps),
  };
}

export type ArrSettings = ReturnType<typeof createArrSettings>;

export const ArrSettingsToken = token<ArrSettings>("arrSettings");

export {
  ApplyError,
  MANAGED_STATUSES,
  PlanConflictError,
  type ManagedProfileRow,
  type ManagedStatus,
  type PlanRequest,
} from "./quality/service.ts";
export { PlanError, planPreset, sizeFormatName, type Plan, type PlanStep, type PlanTarget } from "./quality/plan.ts";
export { clientFor, qualityApiFor, readLive, type ArrClient } from "./quality/live.ts";
export type { LiveQuality, QualityApi } from "./quality/wire.ts";
