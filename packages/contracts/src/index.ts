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

export {
  CLEANUP_MODES,
  DEFAULT_CONSECUTIVE_RUNS,
  DEFAULT_MAX_ACTIONS_PER_RUN,
  DEFAULT_PIN_ROTATION,
  DESTRUCTIVE_CLEANUP_MODES,
  EXTERNAL_GROUP_RULE_TYPES,
  GROUPED_RULE_TYPES,
  DEFAULT_MAX_WRITES_PER_RUN,
  IMPLAUSIBLE_METADATA_FRACTION,
  isCleanupRule,
  isDestructiveMode,
  isGroupedRuleType,
  isMetadataRule,
  isNonPortableField,
  isTagField,
  METADATA_RULE_TAG_FIELDS,
  METADATA_SETTABLE_FIELDS,
  metadataActionIsEmpty,
  NON_PORTABLE_FIELDS,
  producesManyCollections,
  RULE_TYPE_REQUIRES,
  RULE_TYPE_VALUES,
  ruleAction,
  ruleConfigSchema,
  ruleCoversSection,
  TAG_FIELDS,
} from "./rule-config.ts";
export type {
  CleanupActionConfig,
  CleanupMode,
  MetadataActionConfig,
  MetadataSettableField,
  RuleAction,
  RuleConfig,
  RuleRequirement,
  RuleTypeValue,
} from "./rule-config.ts";

export {
  DEFAULT_SORT_LANGUAGES,
  expandTemplate,
  METADATA_TOKENS,
  SORT_ARTICLES,
  sortableTitle,
  templateError,
  unknownTokens,
} from "./metadata-tokens.ts";
export type { MetadataToken, TokenContext } from "./metadata-tokens.ts";

export {
  approximateCount,
  defaultMinItemsForRuleType,
  estimateCollectionCount,
  minItemsOnByDefault,
  VOLUME_SEVERE_THRESHOLD,
  VOLUME_WARN_THRESHOLD,
  volumeLevel,
} from "./collection-volume.ts";
export type { VolumeEstimateInput, VolumeLevel } from "./collection-volume.ts";

export { fieldDef, fieldKind, fieldLabel, LOCAL_FIELD_DEFS, SMART_FILTER_FIELD_DEFS } from "./smart-filter-fields.ts";
export type { SmartFilterFieldDef, SmartFilterFieldKind } from "./smart-filter-fields.ts";

export { EMPTY, formatResolution, formatRuntime } from "./value-format.ts";
export { opLabel, opsFor, withFallbackOp } from "./smart-filter-ops.ts";
export type { OpOption } from "./smart-filter-ops.ts";
export {
  describeCondition,
  formatCalendarDate,
  formatDateValue,
  formatFilterValue,
  isTruthyBoolean,
  parseRelativeDate,
  relativeSpanText,
  resolveRelativeDate,
  toRelativeDate,
  UNSET,
} from "./smart-filter-format.ts";
export type { RelativeDate, RelativeUnit } from "./smart-filter-format.ts";
export { narrateSmartFilter, needsTagLookup } from "./smart-filter-narrate.ts";
export type { NarrateOptions, TagResolver } from "./smart-filter-narrate.ts";

export {
  COLLECTION_POSTER_HEIGHT,
  COLLECTION_POSTER_TEMPLATES,
  COLLECTION_POSTER_WIDTH,
  DEFAULT_PRESENTATION,
  describeSmartFilter,
  POSTER_MAX_BYTES,
  POSTER_SOURCES,
  POSTER_URL_ALLOWED_HOSTS,
  posterUrlError,
  posterUrlRejection,
  presentationConfigSchema,
  resolveCollectionSummary,
  resolvePosterTemplate,
  resolvePresentation,
  SUMMARY_SOURCES,
  templatedCollectionSummary,
} from "./presentation.ts";
export type {
  CollectionPosterTemplateId,
  CollectionSummaryContext,
  PosterSource,
  PosterUrlRejection,
  PresentationConfig,
  SummarySource,
} from "./presentation.ts";

export {
  describeRuleWindow,
  isRuleActiveOn,
  RULE_TRIGGER_LABELS,
  RULE_TRIGGER_NOTES,
  RULE_RUN_TRIGGER_LABELS,
  RULE_TRIGGERS,
  ruleScheduleSchema,
  runsInNightlyBatch,
} from "./rule-schedule.ts";
export type { RuleSchedule, RuleTrigger } from "./rule-schedule.ts";

export {
  DEFAULT_REGISTRY_URL,
  REGISTRY_FORMAT_VERSION,
  registryImportOverridesSchema,
  registryIndexSchema,
  registryPackSchema,
  registryRequirementSchema,
  registryRuleSchema,
} from "./registry.ts";
export type {
  ImportPlan,
  ImportPlanItem,
  RegistryImportOverrides,
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

export { SEEDED_RULE, isSeededRule } from "./seeded-rule.ts";
