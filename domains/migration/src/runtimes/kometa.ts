import { db, collections } from "@tinkerbell/db";
import {
  isKometaClaimed,
  kometaProvider,
  type BucketKind,
  type CollectionInput,
  type MigrationPlan,
} from "@tinkerbell/migrate";
import { summariseBySection, type ProviderRuntime, type ProviderScanResult } from "../runtime.ts";

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
 * through to `future` in the plan and surface in the UI as "supported in
 * a later release". Extend as new rule types land.
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

export const KOMETA_RUNTIME: ProviderRuntime = {
  id: "kometa",
  label: "Kometa",
  // Sourced from already-synced Plex collections — cheap to recount on
  // every collections sync.
  autoScan: true,
  scan(): ProviderScanResult {
    const detected = kometaProvider.detect(loadKometaCollectionInputs());
    return summariseBySection(detected);
  },
  buildPlan(): MigrationPlan {
    const all = loadKometaCollectionInputs();
    const detected = kometaProvider.detect(all);
    const classified = kometaProvider.classify(detected);
    return kometaProvider.buildPlan(classified, { supportedRuleTypes: KOMETA_BUCKET_TO_RULE_TYPE });
  },
  claims: isKometaClaimed,
};
