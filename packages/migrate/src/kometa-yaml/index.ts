/**
 * Reading a Kometa config and turning it into a Tinkerbell migration plan.
 *
 * Pure: no `fs`, no `fetch`, no database. Files arrive as `{path, text}` and
 * anything that has to be *fetched* goes through an injected `FileLoader`.
 * That's what keeps the whole builder mapping table testable against fixture
 * configs with no server running, the same property the title-scan importer
 * next door has.
 */
export { readImport, findConfigFile } from "./read.ts";
export { buildYamlPlan, kometaAssetDirectory } from "./plan.ts";
export { bundleLoader, isYaml, MISSING_REASONS } from "./includes.ts";
export { readConfig, refKey } from "./config.ts";
export { readDefinitions, BUILDER_KEYS } from "./definition.ts";
export { mapDefinition } from "./builders.ts";
export { mapOverlayRef, normaliseOverlays, DEFAULT_OVERLAYS, UNSUPPORTED_OVERLAYS } from "./overlays.ts";
export { readMetadataFile, parseTitleKey, OVERRIDE_FIELDS, OVERRIDE_TAG_FIELDS } from "./metadata.ts";
export { resolveDefault, DEFAULT_MAPPINGS, DEFAULT_SKIPPED, DEFAULT_UNSUPPORTED } from "./defaults.ts";
export { mapFilters, mapPlexSearch } from "./filters.ts";
export { mapSchedule } from "./schedule.ts";
export { expandDefinition } from "./templates.ts";
export { parseYamlFile } from "./parse.ts";

export type { MappedDefinition, UnmappedDefinition, MapOptions } from "./builders.ts";
export type { MappedOverlay, OverlayPosition } from "./overlays.ts";
export type { MetadataOverride, OverrideMatch, OverrideField, OverrideTagField } from "./metadata.ts";
export type { YamlPlanOptions } from "./plan.ts";
export type {
  FileLoader,
  ImportFile,
  KometaConfig,
  KometaDefinition,
  KometaFileRef,
  KometaImport,
  KometaLibrary,
  RefResolution,
} from "./types.ts";
