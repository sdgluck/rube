/**
 * A Plex collection as the migrate package needs it. Deliberately decoupled
 * from any Plex client type so the package stays pure and testable. The
 * server normalizes its own collections into this shape before calling in.
 */
export interface CollectionInput {
  ratingKey: string;
  title: string;
  labels: string[];
  sectionId: string;
  sectionTitle: string;
}

/**
 * Buckets covering every Kometa default collection category we know about.
 * Some of these don't yet have a corresponding Tinkerbell rule type — those
 * are surfaced under "future" in the migration plan so the user knows what
 * will be supported in a later release.
 */
export type BucketKind =
  | "studio"
  | "network"
  | "genre"
  | "country"
  | "actor"
  | "director"
  | "content_rating"
  | "franchise"
  | "decade"
  | "year"
  | "resolution"
  | "audio_language"
  | "subtitle_language"
  | "video_format"
  | "streaming"
  | "based_on"
  | "seasonal"
  | "universe"
  | "award"
  /** External list (MDBList, Trakt, …) — items aren't bucketed by category. */
  | "list"
  /** Plex smart-collection filter — one rule per imported collection. */
  | "smart_filter";

export interface ClassifiedCollection {
  collection: CollectionInput;
  bucket: BucketKind | null;
  reason?: string;
}

/**
 * How faithfully a source item survived the trip.
 *
 * The distinction that matters is `close` vs `partial`: `close` lost something
 * cosmetic (a sort title we can't set yet), `partial` lost something that
 * changes which items land in the collection (a dropped filter, a different
 * data source). A user reviewing a hundred rules needs to know which handful
 * will actually behave differently, and "we mapped it" is not that answer.
 */
export type PlanConfidence = "exact" | "close" | "partial";

/**
 * One thing the mapping couldn't carry across, stated plainly enough to show
 * the user verbatim. `code` exists so the UI can group and the tests can
 * assert without matching on prose.
 */
export interface PlanWarning {
  code: string;
  message: string;
}

/**
 * Where a plan item came from. Title-scan items know only the bucket they
 * were classified into; YAML items can point at the exact file and line, which
 * is what makes the review screen legible when a config has 140 definitions
 * spread over a dozen files.
 */
export interface PlanOrigin {
  kind: "title-scan" | "yaml";
  /** Config-relative path, e.g. "collections/movies.yml". */
  file?: string;
  line?: number;
  /** The Kometa definition (mapping) name. */
  definition?: string;
  /** Kometa builder keys the definition used, e.g. ["imdb_list"]. */
  builders?: string[];
}

/** A parse/resolve-time note that isn't attached to any one plan item. */
export interface PlanDiagnostic {
  severity: "error" | "warn" | "info";
  file?: string;
  line?: number;
  message: string;
}

/**
 * One proposed Tinkerbell rule. Kept in `proposed` if we have a handler
 * available, `future` if the bucket exists but no Tinkerbell rule type
 * supports it yet, and `unmappable` if classification couldn't place it.
 */
export interface PlanItem {
  /**
   * Synthetic id for UI checkbox state. Not a Tinkerbell rule id.
   *
   * Title-scan uses `bucket::sectionId`, which is unique because it *is* the
   * grouping key. YAML items are one-per-definition and need something stable
   * across re-previews of the same import — see `definitionKey`.
   */
  key: string;
  /**
   * Which Kometa default category this came from. Absent for YAML items: a
   * definition built from `imdb_list` belongs to no bucket, and inventing one
   * would put it in a group it has nothing to do with.
   */
  bucket?: BucketKind;
  ruleType: string;
  ruleName: string;
  sectionId: string;
  sectionTitle: string;
  ruleConfig: Record<string, unknown>;
  /**
   * Whether to create the rule switched on. Undefined means disabled, which is
   * what every caller wanted before this field existed.
   */
  enabled?: boolean;
  confidence: PlanConfidence;
  /** What the mapping couldn't carry. Empty for `exact` items. */
  warnings: PlanWarning[];
  origin: PlanOrigin;
  /** Sample collection titles this rule will replace (≤5). */
  sampleNames: string[];
  /** Total Kometa collections in the (bucket, section) group. */
  replacesCount: number;
  /**
   * Plex rating keys of the collections this rule replaces. Title-scan fills
   * this from the group it grouped; YAML fills it by matching the definition's
   * collection name against live Plex collections, so it can legitimately be
   * empty when a definition never produced anything.
   */
  replacesRatingKeys: string[];
}

export interface FuturePlanItem {
  bucket: BucketKind;
  sectionId: string;
  sectionTitle: string;
  sampleNames: string[];
  count: number;
  /**
   * One-line note explaining why we can't migrate this yet (e.g. "decades
   * rule type ships in the next release"). Surfaced verbatim in the UI.
   */
  note: string;
}

export interface UnmappableEntry {
  /** Empty for a YAML definition that never produced a Plex collection. */
  ratingKey: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  reason: string;
  /** Kometa builders that defeated the mapping, for the not-migrated report. */
  builders?: string[];
  file?: string;
  line?: number;
}

export interface MigrationPlan {
  proposed: PlanItem[];
  future: FuturePlanItem[];
  unmappable: UnmappableEntry[];
  /**
   * Problems with the *source* rather than with any one item — a file that
   * wouldn't parse, an include that couldn't be resolved. Kept separate from
   * `unmappable` because these are things the user can go and fix before
   * running, and the Resolve step shows them before mapping is even attempted.
   */
  diagnostics: PlanDiagnostic[];
  /** Total source items the provider considered (sum of proposed/future/unmappable plus already-supported by other rules). */
  totalSourceItems: number;
}

export interface PlanOptions {
  /**
   * Map of bucket kind → Tinkerbell rule type. Lets the server inject the
   * current set of supported rule types — anything not in the map ends up
   * in `future`. Pure-package side never has to know which rule types
   * exist server-side at any given time.
   */
  supportedRuleTypes: Partial<Record<BucketKind, string>>;
}

export interface MigrationProvider {
  id: string;
  /** Filter raw collections to only those this provider manages. */
  detect(collections: CollectionInput[]): CollectionInput[];
  /** Classify each managed collection into a bucket (or null = unmappable). */
  classify(collections: CollectionInput[]): ClassifiedCollection[];
  /** Turn the classified set into a runnable plan. */
  buildPlan(classified: ClassifiedCollection[], opts: PlanOptions): MigrationPlan;
}
