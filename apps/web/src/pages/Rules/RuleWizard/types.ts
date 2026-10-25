/**
 * Form-state contract for the RuleWizard. Each per-rule-type source
 * component reads the slice of state it cares about and writes back via
 * the shared `setForm` setter. Keeping this single shape (rather than a
 * discriminated union per type) lets the wizard switch the active rule
 * type without losing field values the user already entered.
 */

import { DEFAULT_MAX_WRITES_PER_RUN, METADATA_SETTABLE_FIELDS } from "@rube/contracts";
import type {
  ArrService,
  CleanupMode,
  MetadataSettableField,
  PosterSource,
  RuleTrigger,
  SummarySource,
} from "@rube/contracts";
import type { SmartFilterGroup } from "@rube/plex-smart-filter";

export type { CleanupMode, MetadataSettableField };

export type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode, SmartFilterOp } from "@rube/plex-smart-filter";

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
  kind: "collection" | "cleanup" | "metadata" | "playlist";
  mode: CleanupMode;
  consecutiveRuns: number;
  maxActionsPerRun: number;
  viaArr: boolean;
  addImportExclusion: boolean;
  dryRun: boolean;
  /** Cleanup: hold every destructive action until a human approves that item. */
  requireApproval: boolean;
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
  /**
   * Playlist: what to call it, how to order it, and how long to let it get.
   * Held here rather than in the config so switching outcome and back doesn't
   * discard what was typed — the same reason every other field lives here.
   */
  playlistName: string;
  playlistOrder: "handler" | "release_date" | "added_date" | "title" | "random";
  playlistCombineSections: boolean;
  playlistLimit: number;
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

export interface ArrTargetForm {
  /**
   * Which instance to add to. Empty means the service's default — the server
   * the Radarr/Sonarr tabs configure, and what every rule written before split
   * instances existed targets.
   */
  instanceId: string;
  qualityProfileId: number;
  rootFolderPath: string;
}

export interface ArrFormState {
  enabled: boolean;
  /**
   * The services this rule's sections can send to — Radarr for a film
   * library, Sonarr for a TV one. Derived from the Scope step and kept here so
   * validation and saving see the same answer the Actions step showed; only
   * these services' targets are required, and only they are saved.
   */
  services: ArrService[];
  radarr: ArrTargetForm;
  sonarr: ArrTargetForm;
  monitor: boolean;
  searchOnAdd: boolean;
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
  /** ai_prompt: largest collection. */
  maxItems: number;
  /** ai_prompt: who picks the titles — see `aiFill` in contracts. */
  aiFill: "llm" | "recommender";
  sections: string[];
  chart: string;
  listId: string;
  listProvider: "mdblist" | "trakt" | "imdb";
  collectionName: string;
  /** smart_filter rule type: recursive AND/OR tree of clauses. */
  smartFilter: SmartFilterGroup;
  /**
   * Which cleanup preset wrote `smartFilter`, if one did.
   *
   * Presentation only — it is never saved, because the rule it describes is an
   * ordinary smart filter and nothing at run time needs to know where the
   * clauses came from. It survives a reload by being recovered from the tree's
   * shape (`presetFromFilter`), and clearing it is what "edit as a full smart
   * filter" means.
   */
  cleanupPreset?: string;
  /** seerr_requests rule type: status filter ("all" / "approved" / …). */
  filter: string;
  pinToHomepage: boolean;
  /** Pin only this many collections per library per run, rotating. 0 = pin all. */
  pinRotationCount: number;
  /** Only pin collections with at least this many items. 0 = no floor. */
  pinMinItems: number;
  /** Keep the pinned collections first among the collection rows on Home, through shuffles. */
  pinToTop: boolean;
  /** Each run also builds a per-user copy. Collection rules only. */
  personalizable: boolean;
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
  /** Events that also start this rule. Empty means clock-only. */
  triggers: RuleTrigger[];
  /** Rule ids this one runs after, when they run outside the nightly batch. */
  afterRules: string[];
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
  triggers: [],
  afterRules: [],
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
  requireApproval: false,
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
  playlistName: "",
  // The selection's own order is the interesting one — a list source's order
  // is the whole reason somebody wants it as a playlist.
  playlistOrder: "handler",
  playlistCombineSections: true,
  playlistLimit: 0,
};

export const DEFAULT_ARR_TARGET: ArrTargetForm = { instanceId: "", qualityProfileId: 0, rootFolderPath: "" };

export const DEFAULT_ARR_FORM: ArrFormState = {
  enabled: false,
  services: ["radarr"],
  radarr: { ...DEFAULT_ARR_TARGET },
  sonarr: { ...DEFAULT_ARR_TARGET },
  monitor: true,
  searchOnAdd: false,
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
