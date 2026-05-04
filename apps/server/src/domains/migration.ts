import { db, collections } from "@tinkerbell/db";
import { kometaProvider, type BucketKind, type CollectionInput, type MigrationPlan } from "@tinkerbell/migrate";
import { getConfig, setConfig } from "../lib/config.ts";

/**
 * Phase 1 mapping. Buckets not in this map fall through to `future` in the
 * plan and surface in the UI as "supported in a later release". Extend as
 * new rule types land.
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
};

export interface KometaScanResult {
  count: number;
  scannedAt: number;
  bySection: Array<{ sectionId: string; sectionTitle: string; count: number }>;
}

export interface MigrationStatus {
  count: number;
  scannedAt: number | null;
  bySection: KometaScanResult["bySection"];
  dismissedAt: number | null;
  completedAt: number | null;
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
 * Re-scan local collections for Kometa-labelled entries and persist the
 * summary in config. Cheap to call from any sync hook.
 */
export function scanKometaState(): KometaScanResult {
  const all = loadKometaCollectionInputs();
  const detected = kometaProvider.detect(all);

  const sectionMap = new Map<string, { sectionId: string; sectionTitle: string; count: number }>();
  for (const c of detected) {
    const existing = sectionMap.get(c.sectionId);
    if (existing) existing.count++;
    else sectionMap.set(c.sectionId, { sectionId: c.sectionId, sectionTitle: c.sectionTitle, count: 1 });
  }
  const bySection = [...sectionMap.values()].sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle));

  const result: KometaScanResult = {
    count: detected.length,
    scannedAt: Date.now(),
    bySection,
  };
  setConfig("migration_kometa_state", result);
  return result;
}

export function getMigrationStatus(): MigrationStatus {
  const state = getConfig("migration_kometa_state");
  const dismissedAt = getConfig("migration_kometa_dismissed_at") ?? null;
  const completedAt = getConfig("migration_kometa_completed_at") ?? null;
  const count = state?.count ?? 0;
  const scannedAt = state?.scannedAt ?? null;
  const bySection = state?.bySection ?? [];
  const shouldShowBanner = count > 0 && completedAt == null && (scannedAt == null || (dismissedAt ?? 0) < scannedAt);
  return { count, scannedAt, bySection, dismissedAt, completedAt, shouldShowBanner };
}

export function dismissMigrationBanner(): void {
  setConfig("migration_kometa_dismissed_at", Date.now());
}

export function markMigrationCompleted(): void {
  setConfig("migration_kometa_completed_at", Date.now());
}

/**
 * Build a fresh plan from the current local collections. Pure delegation
 * to the migrate package — the bucket-to-rule-type map is the only piece
 * that lives server-side, since it depends on which rule types Tinkerbell
 * has shipped.
 */
export function buildKometaPlan(): MigrationPlan {
  const all = loadKometaCollectionInputs();
  const detected = kometaProvider.detect(all);
  const classified = kometaProvider.classify(detected);
  return kometaProvider.buildPlan(classified, { supportedRuleTypes: KOMETA_BUCKET_TO_RULE_TYPE });
}
