import { db, collections } from "@tinkerbell/db";
import {
  kometaProvider,
  type BucketKind,
  type CollectionInput,
  type MigrationPlan,
  type MigrationProvider,
} from "@tinkerbell/migrate";
import { deleteConfig, getConfig, setConfig } from "@tinkerbell/core";

/**
 * Server-side wrapper around a `MigrationProvider`. Adds the bits the pure
 * package can't know about: human label, how to load source data, and the
 * current bucket → Tinkerbell rule type mapping (which depends on which
 * rule types have shipped).
 */
export interface ProviderRuntime {
  id: string;
  /** Display label for UI (banner, settings page tab). */
  label: string;
  provider: MigrationProvider;
  /** Pull the raw input the provider's `detect` will filter. */
  loadSource(): CollectionInput[];
  /** Bucket → Tinkerbell rule type. Anything missing falls into `future`. */
  supportedRuleTypes: Partial<Record<BucketKind, string>>;
}

export interface ProviderScanResult {
  count: number;
  scannedAt: number;
  bySection: Array<{ sectionId: string; sectionTitle: string; count: number }>;
}

export interface ProviderStatus {
  id: string;
  label: string;
  count: number;
  scannedAt: number | null;
  bySection: ProviderScanResult["bySection"];
  dismissedAt: number | null;
  completedAt: number | null;
  shouldShowBanner: boolean;
}

export interface MigrationStatus {
  providers: ProviderStatus[];
  /** Sum of `count` across all providers — drives banner copy. */
  totalCount: number;
  /** True iff any provider has unmigrated, undismissed items. */
  shouldShowBanner: boolean;
}

function loadKometaCollectionInputs(): CollectionInput[] {
  const rows = db
    .select({
      ratingKey: collections.plexRatingKey,
      title: collections.title,
      labels: collections.labels,
      sectionId: collections.sectionId,
      sectionTitle: collections.sectionTitle,
    })
    .from(collections)
    .all();

  return rows.map((r) => ({
    ratingKey: r.ratingKey,
    title: r.title,
    labels: Array.isArray(r.labels) ? r.labels : [],
    sectionId: r.sectionId,
    sectionTitle: r.sectionTitle,
  }));
}

/**
 * Phase 1 mapping for the Kometa provider. Buckets not in this map fall
 * through to `future` in the plan and surface in the UI as "supported in a
 * later release". Extend as new rule types land.
 */
const KOMETA_BUCKET_TO_RULE_TYPE: Partial<Record<BucketKind, string>> = {
  studio: "studios",
  network: "networks",
  genre: "genres",
  country: "countries",
  actor: "actors",
  director: "directors",
  content_rating: "content_ratings",
  franchise: "tmdb_franchises",
  decade: "decades",
  year: "years",
  resolution: "resolutions",
  audio_language: "audio_languages",
  subtitle_language: "subtitle_languages",
  video_format: "video_formats",
  streaming: "streaming",
  based_on: "based_on",
  seasonal: "seasonal",
  award: "awards",
};

const KOMETA_RUNTIME: ProviderRuntime = {
  id: "kometa",
  label: "Kometa",
  provider: kometaProvider,
  loadSource: loadKometaCollectionInputs,
  supportedRuleTypes: KOMETA_BUCKET_TO_RULE_TYPE,
};

const REGISTRY: Record<string, ProviderRuntime> = {
  [KOMETA_RUNTIME.id]: KOMETA_RUNTIME,
};

export function listProviders(): ProviderRuntime[] {
  return Object.values(REGISTRY);
}

export function getProvider(id: string): ProviderRuntime {
  const runtime = REGISTRY[id];
  if (!runtime) throw new Error(`Unknown migration provider: ${id}`);
  return runtime;
}

/**
 * Fold pre-multi-provider config slots (`migration_kometa_*`) into the new
 * `migration_*` provider-keyed slots on first call. Idempotent — old keys
 * are deleted once read so subsequent calls are no-ops.
 */
function migrateLegacyKometaConfig(): void {
  const legacyState = getConfig("migration_kometa_state");
  if (legacyState) {
    const current = getConfig("migration_state") ?? {};
    if (!current.kometa) {
      setConfig("migration_state", { ...current, kometa: legacyState });
    }
    deleteConfig("migration_kometa_state");
  }

  const legacyDismissed = getConfig("migration_kometa_dismissed_at");
  if (legacyDismissed != null) {
    const current = getConfig("migration_dismissed_at") ?? {};
    if (current.kometa == null) {
      setConfig("migration_dismissed_at", { ...current, kometa: legacyDismissed });
    }
    deleteConfig("migration_kometa_dismissed_at");
  }

  const legacyCompleted = getConfig("migration_kometa_completed_at");
  if (legacyCompleted != null) {
    const current = getConfig("migration_completed_at") ?? {};
    if (current.kometa == null) {
      setConfig("migration_completed_at", { ...current, kometa: legacyCompleted });
    }
    deleteConfig("migration_kometa_completed_at");
  }

  const legacyPending = getConfig("migration_kometa_pending_plan");
  if (legacyPending) {
    if (!getConfig("migration_pending_plan")) {
      setConfig("migration_pending_plan", { providerId: "kometa", ...legacyPending });
    }
    deleteConfig("migration_kometa_pending_plan");
  }
}

/**
 * Re-scan source data for the given provider and persist the summary in
 * config. Cheap to call from any sync hook.
 */
export function scanProviderState(providerId: string): ProviderScanResult {
  migrateLegacyKometaConfig();
  const runtime = getProvider(providerId);
  const detected = runtime.provider.detect(runtime.loadSource());

  const sectionMap = new Map<string, { sectionId: string; sectionTitle: string; count: number }>();
  for (const c of detected) {
    const existing = sectionMap.get(c.sectionId);
    if (existing) existing.count++;
    else sectionMap.set(c.sectionId, { sectionId: c.sectionId, sectionTitle: c.sectionTitle, count: 1 });
  }
  const bySection = [...sectionMap.values()].sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle));

  const result: ProviderScanResult = {
    count: detected.length,
    scannedAt: Date.now(),
    bySection,
  };
  const all = getConfig("migration_state") ?? {};
  setConfig("migration_state", { ...all, [providerId]: result });
  return result;
}

/** Re-scan every registered provider. Called from sync hooks. */
export function scanAllProviders(): void {
  for (const runtime of listProviders()) {
    try {
      scanProviderState(runtime.id);
    } catch (err) {
      console.warn(`[migration] Failed to scan provider ${runtime.id}:`, err);
    }
  }
}

function buildProviderStatus(runtime: ProviderRuntime): ProviderStatus {
  const state = getConfig("migration_state")?.[runtime.id];
  const dismissedAt = getConfig("migration_dismissed_at")?.[runtime.id] ?? null;
  const completedAt = getConfig("migration_completed_at")?.[runtime.id] ?? null;
  const count = state?.count ?? 0;
  const scannedAt = state?.scannedAt ?? null;
  const bySection = state?.bySection ?? [];
  const shouldShowBanner = count > 0 && completedAt == null && (scannedAt == null || (dismissedAt ?? 0) < scannedAt);
  return {
    id: runtime.id,
    label: runtime.label,
    count,
    scannedAt,
    bySection,
    dismissedAt,
    completedAt,
    shouldShowBanner,
  };
}

export function getProviderStatus(providerId: string): ProviderStatus {
  migrateLegacyKometaConfig();
  return buildProviderStatus(getProvider(providerId));
}

export function getMigrationStatus(): MigrationStatus {
  migrateLegacyKometaConfig();
  const providers = listProviders().map(buildProviderStatus);
  const totalCount = providers.reduce((sum, p) => sum + p.count, 0);
  const shouldShowBanner = providers.some((p) => p.shouldShowBanner);
  return { providers, totalCount, shouldShowBanner };
}

export function dismissProvider(providerId: string): void {
  // Validate so callers can't silently write garbage provider ids.
  getProvider(providerId);
  const all = getConfig("migration_dismissed_at") ?? {};
  setConfig("migration_dismissed_at", { ...all, [providerId]: Date.now() });
}

export function markProviderCompleted(providerId: string): void {
  getProvider(providerId);
  const all = getConfig("migration_completed_at") ?? {};
  setConfig("migration_completed_at", { ...all, [providerId]: Date.now() });
}

/**
 * Build a fresh plan for a provider from its current source data. Pure
 * delegation to the migrate package — the bucket-to-rule-type map is the
 * only piece that lives server-side.
 */
export function buildProviderPlan(providerId: string): MigrationPlan {
  const runtime = getProvider(providerId);
  const detected = runtime.provider.detect(runtime.loadSource());
  const classified = runtime.provider.classify(detected);
  return runtime.provider.buildPlan(classified, { supportedRuleTypes: runtime.supportedRuleTypes });
}
