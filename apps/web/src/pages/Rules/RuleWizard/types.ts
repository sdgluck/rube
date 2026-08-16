/**
 * Form-state contract for the RuleWizard. Each per-rule-type source
 * component reads the slice of state it cares about and writes back via
 * the shared `setForm` setter. Keeping this single shape (rather than a
 * discriminated union per type) lets the wizard switch the active rule
 * type without losing field values the user already entered.
 */

import { DEFAULT_MAX_WRITES_PER_RUN, METADATA_SETTABLE_FIELDS } from "@tinkerbell/contracts";
import type { CleanupMode, MetadataSettableField, PosterSource, SummarySource } from "@tinkerbell/contracts";
import type { SmartFilterGroup } from "@tinkerbell/plex-smart-filter";

export type { CleanupMode, MetadataSettableField };

export type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode, SmartFilterOp } from "@tinkerbell/plex-smart-filter";

export type AiVibe = "playful" | "serious" | "mixed";
export type AiNameStyle = "short_punchy" | "descriptive";

/**
 * What happens to the items a rule selects.
 *
 * Held flat rather than as a discriminated union so switching between
 * Collection and Cleanup doesn't discard the settings the user already
 * entered — same reason the rest of this form is one shape.
 */
export interface OutcomeFormState {
  kind: "collection" | "cleanup" | "metadata";
  mode: CleanupMode;
  consecutiveRuns: number;
  maxActionsPerRun: number;
  viaArr: boolean;
  addImportExclusion: boolean;
  dryRun: boolean;
  /**
   * Metadata: the fields this rule writes, as templates. Held as a full map
   * with empty strings for "don't touch", so clearing a field and typing it
   * again doesn't lose the rest — and so the inputs stay controlled.
   */
  set: Record<MetadataSettableField, string>;
  addGenres: string[];
  addLabels: string[];
  removeGenres: string[];
  removeLabels: string[];
  lock: boolean;
  overwriteLocked: boolean;
  maxWritesPerRun: number;
  sortLanguages: string[];
}

/**
 * How this rule's collections look in Plex. Flat, and always present in the
 * form, for the same reason as `OutcomeFormState`: switching the poster off
 * and back on shouldn't discard the accent the user picked.
 */
export interface PresentationFormState {
  summary: SummarySource;
  customSummary: string;
  poster: PosterSource;
  posterUrl: string;
  /** Empty means "take the colour from the collection's own posters". */
  accentColor: string;
}

export const DEFAULT_PRESENTATION_FORM: PresentationFormState = {
  summary: "template",
  customSummary: "",
  // Uploading artwork is a visible, hard-to-undo change to somebody's server.
  // It is opted into per rule the first time, never inherited silently.
  poster: "none",
  posterUrl: "",
  accentColor: "",
};

export interface ArrFormState {
  enabled: boolean;
  /**
   * Which instance to add to. Empty means the service's default — the server
   * the Radarr/Sonarr tabs configure, and what every rule written before split
   * instances existed targets.
   */
  instanceId: string;
  monitor: boolean;
  searchOnAdd: boolean;
  qualityProfileId: number;
  rootFolderPath: string;
  maxAddsPerRun: number;
  dryRun: boolean;
}

export interface RuleFormState {
  id?: string;
  name: string;
  type: string;
  themes: string[];
  customThemes: string[];
  vibe: AiVibe;
  nameStyle: AiNameStyle;
  limit: number;
  minItems: number;
  sections: string[];
  chart: string;
  listId: string;
  listProvider: "mdblist" | "trakt" | "imdb";
  collectionName: string;
  /** smart_filter rule type: recursive AND/OR tree of clauses. */
  smartFilter: SmartFilterGroup;
  /** seerr_requests rule type: status filter ("all" / "approved" / …). */
  filter: string;
  pinToHomepage: boolean;
  /** Pin only this many collections per library per run, rotating. 0 = pin all. */
  pinRotationCount: number;
  /** Only pin collections with at least this many items. 0 = no floor. */
  pinMinItems: number;
  /** Collection (the default, and what every rule did before) or cleanup. */
  outcome: OutcomeFormState;
  /** Summary and poster for the collections this rule builds. */
  presentation: PresentationFormState;
  arr: ArrFormState;
  /** When the rule runs, if not simply "in the nightly batch". */
  schedule: ScheduleFormState;
}

/**
 * Flattened for the form: the wizard needs a stable shape to bind controls to,
 * where the saved config omits every part that isn't in use. `handleSave` is
 * where the two are reconciled.
 */
export interface ScheduleFormState {
  /** Run on this rule's own cron as well as (or instead of) the batch. */
  useCron: boolean;
  cron: string;
  excludeFromBatch: boolean;
  /** Only exist between two dates each year. */
  useWindow: boolean;
  activeFrom: string;
  activeTo: string;
  runOnItemAdded: boolean;
}

/** Every part off: the nightly batch, all year round, as it always was. */
export const DEFAULT_SCHEDULE_FORM: ScheduleFormState = {
  useCron: false,
  // A sensible starting point rather than an empty box — 3am is out of the way
  // and matches the nightly job's own hour.
  cron: "0 3 * * *",
  excludeFromBatch: false,
  useWindow: false,
  activeFrom: "10-01",
  activeTo: "11-05",
  runOnItemAdded: false,
};

/** Every settable field, blank. Blank means "leave this alone". */
const EMPTY_METADATA_SET = Object.fromEntries(METADATA_SETTABLE_FIELDS.map((f) => [f, ""])) as Record<
  MetadataSettableField,
  string
>;

export const DEFAULT_OUTCOME_FORM: OutcomeFormState = {
  kind: "collection",
  // Least destructive first. The wizard makes you pass a confirmation to get
  // past unmonitor, and dryRun stays on until you've seen a preview.
  mode: "collection_only",
  consecutiveRuns: 3,
  maxActionsPerRun: 25,
  viaArr: true,
  addImportExclusion: false,
  dryRun: true,
  set: { ...EMPTY_METADATA_SET },
  addGenres: [],
  addLabels: [],
  removeGenres: [],
  removeLabels: [],
  // An unlocked write is reverted by the next agent refresh, so the rule
  // would appear to work and then silently undo itself.
  lock: true,
  // A locked field is almost always a human's deliberate fix.
  overwriteLocked: false,
  maxWritesPerRun: DEFAULT_MAX_WRITES_PER_RUN,
  sortLanguages: ["en"],
};

export const DEFAULT_ARR_FORM: ArrFormState = {
  enabled: false,
  instanceId: "",
  monitor: true,
  searchOnAdd: false,
  qualityProfileId: 0,
  rootFolderPath: "",
  maxAddsPerRun: 25,
  dryRun: true,
};

export const PRESET_THEMES = [
  "Vibes & tone",
  "Visual style & cinematography",
  "Narrative parallels",
  "Decades & eras",
  "Directors & auteurs",
  "Subgenres",
  "Moods & atmospheres",
  "Unexpected pairings",
  "Hidden gems",
  "Soundtrack-driven",
];

/**
 * Shared shape every per-rule-type source component implements. The
 * wizard renders whichever component matches the current `form.type` and
 * passes the same trio of props.
 */
export interface SourceStepProps {
  form: RuleFormState;
  setForm: (next: RuleFormState) => void;
  /** Used by sources that render config-dependent hints (e.g. seerr). */
  config?: {
    seerrConfigured?: boolean;
  };
  /**
   * A Plex section to read tag values (genres, studios, …) from when
   * populating pickers. Rules can target several sections, or all of them —
   * this is whichever one is representative, not part of the saved rule.
   * Null when Plex hasn't been reached yet.
   */
  tagSectionId?: string | null;
}
