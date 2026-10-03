/**
 * The quality endpoints' documents, as one shape for both apps.
 *
 * Radarr and Sonarr diverge almost everywhere, but not here. A quality profile,
 * a custom format and a quality definition are byte-for-byte the same
 * document in both, because both inherited them from the same code. The
 * per-app clients keep their own named types (there is deliberately no shared
 * base). The planner works on this structural
 * subset, which both satisfy, rather than branching on the service to pick
 * one.
 */

export interface WireQuality {
  id: number;
  name: string;
  [extra: string]: unknown;
}

export interface WireProfileItem {
  id?: number;
  name?: string;
  quality?: WireQuality;
  items: WireProfileItem[];
  allowed: boolean;
}

export interface WireProfile {
  id?: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff?: number;
  minFormatScore?: number;
  cutoffFormatScore?: number;
  minUpgradeFormatScore?: number;
  items?: WireProfileItem[];
  formatItems?: Array<{ format: number; name?: string; score: number }>;
  [extra: string]: unknown;
}

export interface WireField {
  name: string;
  value?: unknown;
  [extra: string]: unknown;
}

export interface WireSpec {
  id?: number;
  name: string;
  implementation: string;
  implementationName?: string;
  negate: boolean;
  required: boolean;
  fields: WireField[];
}

export interface WireCustomFormat {
  id?: number;
  name: string;
  includeCustomFormatWhenRenaming?: boolean;
  specifications: WireSpec[];
}

export interface WireDefinition {
  id: number;
  quality: WireQuality;
  title: string;
  weight?: number;
  minSize: number | null;
  maxSize: number | null;
  preferredSize: number | null;
}

/** Everything the planner reads from one instance. */
export interface LiveQuality {
  version: string;
  capabilities: string[];
  profileSchema: WireProfile;
  profiles: WireProfile[];
  customFormats: WireCustomFormat[];
  /** Spec templates from `/customformat/schema`. Empty where custom formats are unsupported. */
  specSchema: WireSpec[];
  definitions: WireDefinition[];
}

/**
 * The calls the planner and applier make. Both clients' `settings` objects
 * satisfy it, and so does a test double.
 */
export interface QualityApi {
  status(): Promise<{ version: string }>;
  capabilities(version: string): string[];
  qualityProfiles(): Promise<WireProfile[]>;
  qualityProfileSchema(): Promise<WireProfile>;
  createQualityProfile(profile: WireProfile): Promise<WireProfile>;
  updateQualityProfile(id: number, profile: WireProfile): Promise<WireProfile>;
  deleteQualityProfile(id: number): Promise<unknown>;
  qualityDefinitions(): Promise<WireDefinition[]>;
  updateQualityDefinitions(definitions: WireDefinition[]): Promise<unknown>;
  customFormats(): Promise<WireCustomFormat[]>;
  customFormatSchema(): Promise<WireSpec[]>;
  createCustomFormat(format: WireCustomFormat): Promise<WireCustomFormat>;
  updateCustomFormat(id: number, format: WireCustomFormat): Promise<WireCustomFormat>;
  deleteCustomFormat(id: number): Promise<unknown>;
  readProfilesArea(): Promise<Record<string, unknown>>;
}
