/**
 * Builds the preview shown before anything is written.
 *
 * The point of a preview is that everything which could disappoint the user
 * after import shows up before it: a clause that won't match on this server,
 * an integration that isn't configured, a name that already exists. Import
 * itself then does no thinking — it writes what the plan says.
 */

import type {
  ImportPlan,
  ImportPlanItem,
  RegistryImportOverrides,
  RegistryRequirement,
  RegistryRule,
} from "@rube/contracts";

import { applyImportOverrides } from "./overrides.ts";
import { resolveRuleForImport, type ResolveTarget, type TagLookup } from "./resolve.ts";
import { type ConfigStore } from "@rube/core";
import { type Rules } from "@rube/domain.rules";
import { type RegistryFetch } from "./fetch.ts";

/**
 * Suffix a colliding name rather than refusing the import. Matches the
 * Rules page's own duplicate convention, and keeps re-importing a pack
 * non-destructive — the user's existing rule is never touched.
 */
function dedupeName(name: string, taken: Set<string>): { name: string; collided: boolean } {
  if (!taken.has(name)) return { name, collided: false };
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return { name: candidate, collided: true };
  }
}

export interface BuildPlanInput {
  packSlug?: string | null;
  ruleSlugs: string[];
  targets: ResolveTarget[];
  /** The importing user's tweaks to the pack's published config. */
  overrides?: RegistryImportOverrides;
}

export interface PlanDeps {
  config: ConfigStore;
  rules: Rules;
  registry: RegistryFetch;
}
export function createPlan(deps: PlanDeps) {
  const { getConfig } = deps.config;
  const { getRules } = deps.rules;
  const { getRegistry } = deps.registry;

  /** Integrations a rule can depend on, and how to tell if they're set up. */
  function missingRequirements(rule: RegistryRule): RegistryRequirement[] {
    const missing: RegistryRequirement[] = [];
    for (const req of rule.requires) {
      const configured =
        req === "omdb"
          ? !!getConfig("global_omdb_api_key")
          : req === "tmdb"
            ? !!getConfig("global_tmdb_api_key")
            : req === "seerr"
              ? !!getConfig("global_seerr_url") && !!getConfig("global_seerr_api_key")
              : req === "mdblist"
                ? !!getConfig("global_mdblist_api_key")
                : req === "llm"
                  ? !!getConfig("global_llm")?.provider || !!getConfig("global_anthropic_api_key")
                  : true;
      if (!configured) missing.push(req);
    }
    return missing;
  }

  async function buildImportPlan(input: BuildPlanInput, lookup: TagLookup): Promise<ImportPlan> {
    const { packsBySlug, rulesBySlug } = await getRegistry();

    if (input.targets.length === 0) {
      throw new Error("Pick at least one library to import into.");
    }

    const pack = input.packSlug ? packsBySlug.get(input.packSlug) : null;
    if (input.packSlug && !pack) {
      throw new Error(`Unknown registry pack "${input.packSlug}".`);
    }

    // Seeded from existing rules so a pack importing two rules that would both
    // collide gets "(2)" and "(3)", not "(2)" twice.
    const taken = new Set(getRules().map((r) => r.name));
    const items: ImportPlanItem[] = [];

    for (const slug of input.ruleSlugs) {
      const rule = rulesBySlug.get(slug);
      if (!rule) throw new Error(`Unknown registry rule "${slug}".`);

      const { config, warnings } = await resolveRuleForImport(rule, input.targets, lookup);
      // Overrides land after resolution so the preview shows exactly what gets
      // written — the plan is the contract, and import does no thinking.
      const overridden = applyImportOverrides(rule.type, config, input.overrides);
      const { name, collided } = dedupeName(rule.name, taken);
      taken.add(name);

      items.push({
        rule,
        config: overridden,
        name,
        nameCollision: collided,
        resolutionWarnings: warnings,
        missingRequirements: missingRequirements(rule),
      });
    }

    return {
      packSlug: pack?.slug ?? null,
      packVersion: pack?.version ?? null,
      sectionTitles: input.targets.map((t) => t.sectionTitle),
      items,
    };
  }

  return { buildImportPlan };
}
