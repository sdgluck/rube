/**
 * Assembles the published registry from the authored source modules and
 * parses it through the shared schema, so an invalid pack is a build-time
 * failure rather than something an instance discovers mid-import.
 *
 * `requires` is derived from the rule type rather than hand-written on each
 * rule — a pack author shouldn't have to remember that `awards` needs TMDb.
 * Anything explicitly listed on the rule is merged in on top.
 */
import {
  registryIndexSchema,
  REGISTRY_FORMAT_VERSION,
  RULE_TYPE_REQUIRES,
  type RegistryIndex,
  type RegistryRuleInput,
} from "@rube/contracts";
import { PACKS } from "./packs.ts";
import { AI_RULES } from "./rules/ai.ts";
import { EXTERNAL_RULES } from "./rules/external.ts";
import { LIBRARY_RULES } from "./rules/library.ts";
import { SMART_RULES } from "./rules/smart.ts";

const AUTHORED_RULES: RegistryRuleInput[] = [...LIBRARY_RULES, ...EXTERNAL_RULES, ...SMART_RULES, ...AI_RULES];

function withDerivedRequirements(rule: RegistryRuleInput): RegistryRuleInput {
  const fromType = RULE_TYPE_REQUIRES[rule.type as keyof typeof RULE_TYPE_REQUIRES];
  const declared = rule.requires ?? [];
  const merged = fromType && !declared.includes(fromType) ? [...declared, fromType] : declared;
  return { ...rule, requires: merged };
}

/**
 * `generatedAt` is injected by the build script rather than read from the
 * clock here, so importing this module from a page (or a test) doesn't
 * produce a different index every render.
 */
export function buildRegistryIndex(generatedAt: number): RegistryIndex {
  return registryIndexSchema.parse({
    formatVersion: REGISTRY_FORMAT_VERSION,
    generatedAt,
    packs: PACKS,
    rules: AUTHORED_RULES.map(withDerivedRequirements),
  });
}

/** The catalogue as the site renders it. Timestamp is irrelevant in-page. */
export const REGISTRY: RegistryIndex = buildRegistryIndex(0);

export const PACKS_BY_SLUG = new Map(REGISTRY.packs.map((p) => [p.slug, p]));
export const RULES_BY_SLUG = new Map(REGISTRY.rules.map((r) => [r.slug, r]));

export function rulesForPack(packSlug: string) {
  const pack = PACKS_BY_SLUG.get(packSlug);
  if (!pack) return [];
  return pack.ruleSlugs.flatMap((slug) => {
    const rule = RULES_BY_SLUG.get(slug);
    return rule ? [rule] : [];
  });
}

/** Union of every requirement across a pack's rules — drives the "needs TMDb"
 *  chips on the pack card without the caller walking rules itself. */
export function requirementsForPack(packSlug: string): string[] {
  const seen = new Set<string>();
  for (const rule of rulesForPack(packSlug)) {
    for (const req of rule.requires) seen.add(req);
  }
  return [...seen].sort();
}
