// Re-exports of types that cross the apps boundary (web ↔ server).
// Web should never import directly from server-side packages — only from here
// or from @tinkerbell/trpc (for AppRouter).

export {
  arrTargetFor,
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
  isPlaylistRule,
  PLAYLIST_CAPABLE_RULE_TYPES,
  isNonPortableField,
  isPersonalizableAction,
  isTagField,
  METADATA_RULE_TAG_FIELDS,
  METADATA_SETTABLE_FIELDS,
  metadataActionIsEmpty,
  NON_PORTABLE_FIELDS,
  producesManyCollections,
  rotatesPins,
  RULE_TYPE_REQUIRES,
  RULE_TYPE_VALUES,
  ruleAction,
  ruleCollectionCount,
  ruleConfigSchema,
  ruleCoversSection,
  TAG_FIELDS,
} from "./rule-config.ts";
export type {
  ArrTarget,
  RuleCollectionCount,
  CleanupActionConfig,
  CleanupMode,
  MetadataActionConfig,
  PlaylistActionConfig,
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

export { EMPTY, formatFileSize, formatResolution, formatRuntime } from "./value-format.ts";
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
export { ALWAYS_ON_JOB_IDS, isAlwaysOnJob } from "./always-on-jobs.ts";
export type { AlwaysOnJobId } from "./always-on-jobs.ts";
export { CHANGE_LOG_ACTIONS, CHANGE_LOG_ENTITIES } from "./change-log.ts";
export type { ChangeLogAction, ChangeLogEntity } from "./change-log.ts";
export { translateSmartFilterTags } from "./portable-rule.ts";
export { BUNDLE_FORMAT_VERSION, BUNDLE_PARTS, bundleSchema, IMPORT_RESOLUTIONS, IMPORT_VERDICTS } from "./bundle.ts";
export type {
  Bundle,
  BundlePart,
  ExportedJob,
  ExportedOverlayConfig,
  ExportedManagedProfile,
  ExportedPreset,
  ExportedRule,
  ImportResolution,
  ImportVerdict,
} from "./bundle.ts";
export type {
  TagDirection,
  TagLookup,
  TagTranslationTarget,
  TagTranslationWarning,
  TranslateResult,
} from "./portable-rule.ts";
export type { NarrateOptions, TagResolver } from "./smart-filter-narrate.ts";

export {
  COLLECTION_MODE_VALUES,
  COLLECTION_MODES,
  COLLECTION_POSTER_HEIGHT,
  COLLECTION_POSTER_TEMPLATES,
  COLLECTION_POSTER_WIDTH,
  COLLECTION_SORT_VALUES,
  COLLECTION_SORTS,
  DEFAULT_PRESENTATION,
  describeSmartFilter,
  POSTER_MAX_BYTES,
  POSTER_SOURCES,
  POSTER_URL_ALLOWED_HOSTS,
  posterUrlError,
  posterUrlRejection,
  presentationConfigSchema,
  resolveCollectionPrefs,
  resolveCollectionSummary,
  resolvePosterTemplate,
  resolvePresentation,
  resolveSortTitle,
  SUMMARY_SOURCES,
  templatedCollectionSummary,
} from "./presentation.ts";
export type {
  CollectionModeChoice,
  CollectionPosterTemplateId,
  CollectionSortChoice,
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
  RULE_TRIGGER_CADENCE,
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

export {
  ARR_SERVICES,
  ARR_SETTINGS_AREAS,
  ARR_SETTINGS_AREA_LABELS,
  ARR_CAPABILITIES,
  ARR_ACTIVITY_EVENT_TYPES,
  MINIMUM_AVAILABILITY,
  SERIES_MONITOR_MODES,
  STUCK_QUEUE_STATES,
  arrAddTargetSchema,
  formatBytes,
  formatCustomFormatScore,
  seriesProgress,
  type ArrActivityEventType,
  type ArrAddTarget,
  type ArrCapability,
  type ArrInstanceSummary,
  type ArrService,
  type ArrSettingsArea,
  type MinimumAvailability,
  type SeriesMonitorMode,
} from "./arr.ts";

export * from "./arr-quality/index.ts";

export {
  PROBLEM_KINDS,
  PROBLEM_META,
  isProblemKind,
  type ProblemKind,
  type ProblemKindMeta,
  type ProblemSeverity,
} from "./problems.ts";

export { TMDB_IMAGE_BASE, tmdbPosterUrl, serviceForMediaType, type TmdbPosterSize } from "./discover.ts";
export {
  PORTAL_PREROLL_DEFAULTS,
  PORTAL_PREROLL_DURATION_MAX,
  PORTAL_PREROLL_DURATION_MIN,
  PORTAL_PREROLL_HEADLINE_MAX,
  PORTAL_PREROLL_MESSAGE_MAX,
  portalPrerollCardInput,
  portalPrerollCardSchema,
  resolvePortalPrerollCard,
} from "./portal-preroll.ts";
export type { PortalPrerollCard, PortalPrerollCardInput } from "./portal-preroll.ts";
export {
  RULE_CONCURRENCY_DEFAULT,
  RULE_CONCURRENCY_MAX,
  applyConfigPatch,
  bywJobConfigSchema,
  wtylJobConfigSchema,
  pibuJobConfigSchema,
  collectionArtJobConfigSchema,
  collectionsSweepJobConfigSchema,
  commonJobConfigSchema,
  configIssues,
  configSchemaFor,
  digestJobConfigSchema,
  generateJobConfigSchema,
  JobConfigError,
  lockedConfigFor,
  noJobConfigSchema,
  overlaysJobConfigSchema,
  validateConfigPatch,
  validateJobConfig,
} from "./job-config.ts";
export type {
  BywJobConfig,
  WtylJobConfig,
  PibuJobConfig,
  CollectionArtJobConfig,
  CollectionsSweepJobConfig,
  CommonJobConfig,
  DigestJobConfig,
  GenerateJobConfig,
  OverlaysJobConfig,
} from "./job-config.ts";
export {
  FEATURE_IDS,
  isFeatureId,
  JOB_PRESENTATION,
  jobPresentation,
  SYSTEM_GROUPS,
  systemGroupOf,
} from "./job-presentation.ts";
export type { FeatureId, JobKind, JobPresentation, SystemGroup } from "./job-presentation.ts";
export {
  allVariants,
  BYW_DEFAULTS,
  WTYL_DEFAULTS,
  PIBU_DEFAULTS,
  commandsWithFields,
  DIGEST_DEFAULTS,
  fieldsFor,
  variantFor,
  variantsForJob,
} from "./job-fields.ts";
export type { FieldControl, FieldSpec, VariantSpec } from "./job-fields.ts";

export { formatClock, isValidTimezone, minutesOfDay, parseClock } from "./clock.ts";
export {
  cronError,
  DAY_MS,
  describeDays,
  describeSchedule,
  dstShifts,
  formatSchedule,
  HOUR_MS,
  INTERVAL_STEPS,
  minGapMs,
  MINUTE_MS,
  parseSchedule,
  sameSchedule,
  SECOND_MS,
  wallClock,
  WEEK_MINUTES,
  weekOccurrences,
} from "./job-schedule.ts";
export type { DstShift, IntervalUnit, JobSchedule } from "./job-schedule.ts";
export {
  ALL_MONTHS,
  builderError,
  DEFAULT_BUILDER,
  describeBuilder,
  formatBuilder,
  MONTH_NAMES,
  NTH_OPTIONS,
  parseBuilder,
  REPEAT_HOUR_STEPS,
  REPEAT_MINUTE_STEPS,
  timesError,
  WEEKDAY_NAMES,
} from "./schedule-builder.ts";
export type { BuilderDays, BuilderSchedule, BuilderTime, Nth } from "./schedule-builder.ts";
export {
  canDisableJob,
  HEAVY_JOB_IDS,
  isSchedulableJob,
  JOB_ORDER,
  JOB_SCHEDULE_META,
  jobScheduleMeta,
  RECOMMENDED_SCHEDULE_SETTINGS,
  SCHEDULE_SERVICE_LABELS,
} from "./job-schedule-meta.ts";
export type { JobOrderEdge, JobScheduleMeta, ScheduleCapabilities, ScheduleService } from "./job-schedule-meta.ts";
export {
  applyFix,
  scheduleSettingsSchema,
  diffSchedulePlans,
  diffScheduleSettings,
  effectiveTimezone,
  FREQUENT_HEAVY_MS,
  hasBlockingIssues,
  inWindow,
  isJobChanged,
  planFromContext,
  roundUpTo,
  SNAP_MINUTES,
  typicalDurationMs,
  validateSchedulePlan,
} from "./job-schedule-validate.ts";
export type {
  JobPlanEntry,
  ScheduleContext,
  ScheduleFix,
  ScheduleIssue,
  ScheduleIssueCode,
  ScheduleJob,
  ScheduleLane,
  SchedulePlan,
  ScheduleSettings,
  ScheduleSeverity,
} from "./job-schedule-validate.ts";
export { buildPreset, packChain, SCHEDULE_PRESETS } from "./job-schedule-presets.ts";
export type { SchedulePreset } from "./job-schedule-presets.ts";

export {
  isPortalComponentId,
  PORTAL_COMPONENT_IDS,
  PORTAL_COMPONENTS,
  resolvePortalComponents,
  TASTES_PREFERENCE_KEYS,
} from "./portal-components.ts";
export type {
  PortalComponentGroup,
  PortalComponentId,
  PortalComponentState,
  PortalPrerequisite,
} from "./portal-components.ts";
export {
  describeMatchFilters,
  MATCH_CODE_ALPHABET,
  MATCH_CODE_LENGTH,
  matchCodeSchema,
  matchFiltersSchema,
} from "./match.ts";
export type { MatchFilters } from "./match.ts";
export { DEFAULT_UI_SCALE, isUiScale, UI_SCALES } from "./ui-scale.ts";
export type { UiScale } from "./ui-scale.ts";
export * from "./download-clients.ts";
export { NATIVE_APPS, nativeOrigins, type NativeApp } from "./native-apps.ts";
export { SYSTEM_COLLECTION_LABELS } from "./system-labels.ts";
export { parseLogLine, stampLog } from "./run-log.ts";
