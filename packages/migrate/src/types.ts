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
 * One proposed Tinkerbell rule. Kept in `proposed` if we have a handler
 * available, `future` if the bucket exists but no Tinkerbell rule type
 * supports it yet, and `unmappable` if classification couldn't place it.
 */
export interface PlanItem {
  /** Synthetic id for UI checkbox state. Not a Tinkerbell rule id. */
  key: string;
  bucket: BucketKind;
  ruleType: string;
  ruleName: string;
  sectionId: string;
  sectionTitle: string;
  ruleConfig: Record<string, unknown>;
  /** Sample collection titles this rule will replace (≤5). */
  sampleNames: string[];
  /** Total Kometa collections in the (bucket, section) group. */
  replacesCount: number;
  /** Plex rating keys of the collections this rule replaces. */
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
  ratingKey: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  reason: string;
}

export interface MigrationPlan {
  proposed: PlanItem[];
  future: FuturePlanItem[];
  unmappable: UnmappableEntry[];
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
