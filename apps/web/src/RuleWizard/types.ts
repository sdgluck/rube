/**
 * Form-state contract for the RuleWizard. Each per-rule-type source
 * component reads the slice of state it cares about and writes back via
 * the shared `setForm` setter. Keeping this single shape (rather than a
 * discriminated union per type) lets the wizard switch the active rule
 * type without losing field values the user already entered.
 */

import type { SmartFilterGroup } from "@tinkerbell/plex-smart-filter";

export type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode, SmartFilterOp } from "@tinkerbell/plex-smart-filter";

export type AiVibe = "playful" | "serious" | "mixed";
export type AiNameStyle = "short_punchy" | "descriptive";

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
  arr: ArrFormState;
}

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
}
