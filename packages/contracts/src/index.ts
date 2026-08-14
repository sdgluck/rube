// Re-exports of types that cross the apps boundary (web ↔ server).
// Web should never import directly from server-side packages — only from here
// or from @tinkerbell/trpc (for AppRouter).

/**
 * Bounds for the generate job's `ruleConcurrency` setting. They live here
 * because both sides need them and neither owns them: the schema in
 * `@tinkerbell/core` enforces the max, the job applies the default, and the
 * admin UI renders the input — and web can't import either of those.
 */
export const RULE_CONCURRENCY_DEFAULT = 3;
export const RULE_CONCURRENCY_MAX = 8;

export { isTagField, RULE_TYPE_REQUIRES, RULE_TYPE_VALUES, ruleConfigSchema, TAG_FIELDS } from "./rule-config.ts";
export type { RuleConfig, RuleRequirement, RuleTypeValue } from "./rule-config.ts";

export {
  DEFAULT_REGISTRY_URL,
  REGISTRY_FORMAT_VERSION,
  registryIndexSchema,
  registryPackSchema,
  registryRequirementSchema,
  registryRuleSchema,
} from "./registry.ts";
export type {
  ImportPlan,
  ImportPlanItem,
  RegistryIndex,
  RegistryPack,
  RegistryPackInput,
  RegistryRequirement,
  RegistryRule,
  RegistryRuleInput,
  RegistryUpdate,
  ResolutionWarning,
} from "./registry.ts";

export type {
  Badge,
  BadgeShape,
  BadgeStyle,
  ColorPreset,
  ConditionalRule,
  FontSize,
  MediaInfo,
  OverlayPosition,
  OverlayType,
  Ratings,
} from "@tinkerbell/overlays";
