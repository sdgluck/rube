/**
 * The public rule registry: fetching the catalogue, resolving a listing
 * against this server's libraries, importing it as a rule, and noticing when
 * an imported rule has a newer version published.
 *
 * Resolution, override application and hashing are pure and stay module
 * exports. The four halves that read config or write rules are factories.
 * `fetch` is built first because the other three read the catalogue through it.
 */
import { token } from "@tinkerbell/container";
import type { ConfigStore } from "@tinkerbell/core";
import type { Rules } from "@tinkerbell/domain.rules";
import { createFetch, registryUrl } from "./fetch.ts";
import { createPlan } from "./plan.ts";
import { createImport } from "./import.ts";
import { createUpdates } from "./updates.ts";

export { registryUrl };
export { resolveRuleForImport, type ResolveTarget, type ResolvedRule, type TagLookup } from "./resolve.ts";
export { type BuildPlanInput } from "./plan.ts";
export { applyImportOverrides } from "./overrides.ts";
export { type ImportOptions } from "./import.ts";
export { hashConfig } from "./hash.ts";

export interface RegistryDeps {
  config: ConfigStore;
  rules: Rules;
}

export function createRegistry(deps: RegistryDeps) {
  const registry = createFetch(deps);
  const withFetch = { ...deps, registry };
  return {
    ...registry,
    ...createPlan(withFetch),
    ...createImport(withFetch),
    ...createUpdates(withFetch),
  };
}

export type Registry = ReturnType<typeof createRegistry>;

export const RegistryToken = token<Registry>("registry");
