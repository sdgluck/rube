import { db, collections } from "@tinkerbell/db";
import {
  buildPlexSmartPlan,
  detectSmartCollections,
  type CollectionInput,
  type MigrationPlan,
  type SmartCollectionInput,
} from "@tinkerbell/migrate";
import { listProviders } from "../registry.ts";
import { isTinkerbellOwned, summariseBySection, type ProviderRuntime, type ProviderScanResult } from "../runtime.ts";

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

/**
 * Drop rows that another provider already claims (e.g. Kometa-labeled
 * smart collections belong to Kometa, not the generic Plex Smart importer),
 * and rows this server generated itself. Keeps Plex Smart as the catch-all for
 * *user-authored* smart collections that don't fall under a more specific
 * provider's claim — being the catch-all is exactly why it has to exclude our
 * own output explicitly: no other provider claims it, so without this every
 * generated collection reads as an unmigrated one.
 */
function rejectClaimedByOthers(inputs: SmartCollectionInput[]): SmartCollectionInput[] {
  const others = listProviders().filter((p) => p.id !== PLEX_SMART_RUNTIME.id);
  return inputs.filter((c) => !isTinkerbellOwned(c) && !others.some((p) => p.claims(c)));
}

export const PLEX_SMART_RUNTIME: ProviderRuntime = {
  id: "plex-smart",
  label: "Plex Smart Collections",
  // Sourced from already-synced Plex collections — same cost as Kometa.
  autoScan: true,
  scan(): ProviderScanResult {
    const detected = detectSmartCollections(rejectClaimedByOthers(loadPlexSmartCollectionInputs()));
    return summariseBySection(detected);
  },
  buildPlan(): MigrationPlan {
    const detected = detectSmartCollections(rejectClaimedByOthers(loadPlexSmartCollectionInputs()));
    return buildPlexSmartPlan(detected);
  },
  // Claim every smart collection — symmetric with the other providers'
  // `claims`, so a future generic provider can know to defer to us.
  claims(input: CollectionInput): boolean {
    return (input as Partial<SmartCollectionInput>).smart === true;
  },
};
