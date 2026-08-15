/**
 * Form-state contract for the RuleWizard. Each per-rule-type source
 * component reads the slice of state it cares about and writes back via
 * the shared `setForm` setter. Keeping this single shape (rather than a
 * discriminated union per type) lets the wizard switch the active rule
 * type without losing field values the user already entered.
 */

import type { CleanupMode } from "@tinkerbell/contracts";
import type { SmartFilterGroup } from "@tinkerbell/plex-smart-filter";

export type { CleanupMode };

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
  kind: "collection" | "cleanup";
  mode: CleanupMode;
  consecutiveRuns: number;
  maxActionsPerRun: number;
  viaArr: boolean;
  addImportExclusion: boolean;
  dryRun: boolean;
}

export interface ArrFormState {
  enabled: boolean;
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
  /** Collection (the default, and what every rule did before) or cleanup. */
  outcome: OutcomeFormState;
  arr: ArrFormState;
}

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
};

export const DEFAULT_ARR_FORM: ArrFormState = {
  enabled: false,
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
