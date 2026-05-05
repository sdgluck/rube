import { db, collections } from "@tinkerbell/db";
import {
  buildPlexSmartPlan,
  detectSmartCollections,
  type MigrationPlan,
  type SmartCollectionInput,
} from "@tinkerbell/migrate";
import { summariseBySection, type ProviderRuntime, type ProviderScanResult } from "../runtime.ts";

function loadPlexSmartCollectionInputs(): SmartCollectionInput[] {
  const rows = db
    .select({
      ratingKey: collections.plexRatingKey,
      title: collections.title,
      labels: collections.labels,
      sectionId: collections.sectionId,
      sectionTitle: collections.sectionTitle,
      smart: collections.smart,
      smartFilter: collections.smartFilter,
    })
    .from(collections)
    .all();

  return rows.map((r) => ({
    ratingKey: r.ratingKey,
    title: r.title,
    labels: Array.isArray(r.labels) ? r.labels : [],
    sectionId: r.sectionId,
    sectionTitle: r.sectionTitle,
    smart: r.smart === 1,
    smartFilter: r.smartFilter ?? "",
  }));
}

export const PLEX_SMART_RUNTIME: ProviderRuntime = {
  id: "plex-smart",
  label: "Plex Smart Collections",
  // Sourced from already-synced Plex collections — same cost as Kometa.
  autoScan: true,
  scan(): ProviderScanResult {
    const detected = detectSmartCollections(loadPlexSmartCollectionInputs());
    return summariseBySection(detected);
  },
  buildPlan(): MigrationPlan {
    const detected = detectSmartCollections(loadPlexSmartCollectionInputs());
    return buildPlexSmartPlan(detected);
  },
};
