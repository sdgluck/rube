import type { CollectionInput, MigrationPlan } from "@tinkerbell/migrate";

/**
 * Server-side wrapper around a migration source. Each provider owns its
 * own scan + plan logic so the registry is just routing — sources whose
 * data lives in already-synced Plex tables (Kometa, Plex Smart) coexist
 * with sources whose data lives in an external API (MDBList, Trakt)
 * without forcing one shape on the other.
 */
export interface ProviderRuntime {
  id: string;
  /** Display label for UI (banner, settings page tab). */
  label: string;
  /**
   * True if this provider should be scanned on every collections sync.
   * Set false for API-backed providers so the cron sync doesn't fan out
   * to external services on every run.
   */
  autoScan: boolean;
  /** Cheap re-scan: re-counts source items. May be sync or async. */
  scan(): Promise<ProviderScanResult> | ProviderScanResult;
  /** Build a fresh migration plan. May be expensive for API providers. */
  buildPlan(): Promise<MigrationPlan> | MigrationPlan;
  /**
   * True if this provider considers `input` its own. Used by less-specific
   * providers (e.g. Plex Smart) to avoid double-claiming collections that
   * a more specific provider (Kometa via its label, Trakt, etc.) already
   * manages. Providers whose source isn't Plex collection rows (MDBList,
   * Trakt user lists) return `false` — they have nothing to compete over
   * row-wise.
   */
  claims(input: CollectionInput): boolean;
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

/**
 * Compress a flat list of source items into the per-section count
 * shape used by the status UI. Shared between every Plex-table-backed
 * runtime so they don't each reinvent the grouping.
 */
export function summariseBySection(items: CollectionInput[]): ProviderScanResult {
  const sectionMap = new Map<string, { sectionId: string; sectionTitle: string; count: number }>();
  for (const c of items) {
    const existing = sectionMap.get(c.sectionId);
    if (existing) existing.count++;
    else sectionMap.set(c.sectionId, { sectionId: c.sectionId, sectionTitle: c.sectionTitle, count: 1 });
  }
  const bySection = [...sectionMap.values()].sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle));
  return { count: items.length, scannedAt: Date.now(), bySection };
}
