import type { CollectionInput, MigrationPlan } from "@tinkerbell/migrate";

/**
 * Server-side wrapper around a migration source. Each provider owns its
 * own scan + plan logic so the registry is just routing — sources whose
 * data lives in already-synced Plex tables (Kometa, Plex Smart) coexist
 * with sources whose data lives in an external API (MDBList, Trakt)
 * without forcing one shape on the other.
 */
/**
 * Declares that a provider can't plan anything until the user hands it
 * something. Providers that derive their plan from server-side state omit
 * this; the UI reads its presence as "show an upload step first".
 */
export interface ProviderIngest {
  kind: "files";
  /** File extensions for the picker's `accept`, e.g. [".yml", ".yaml"]. */
  accept: string[];
}

/** What `buildPlan` needs beyond server state. Empty for scan-based providers. */
export interface BuildPlanInput {
  /** Row id in `migration_imports` holding the uploaded bundle. */
  importId?: string;
}

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
  /**
   * Set when the provider plans from user-supplied files rather than from
   * anything already on the server. Absent means `buildPlan()` can be called
   * with no input, which is what every scan-based provider does.
   */
  ingest?: ProviderIngest;
  /** Cheap re-scan: re-counts source items. May be sync or async. */
  scan(): Promise<ProviderScanResult> | ProviderScanResult;
  /**
   * Build a fresh migration plan. May be expensive for API providers.
   *
   * `input` is optional so the scan-based providers keep their zero-argument
   * implementations — they have nothing to read from it.
   */
  buildPlan(input?: BuildPlanInput): Promise<MigrationPlan> | MigrationPlan;
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
 * True if this collection is Tinkerbell's own output.
 *
 * Migration exists to adopt collections *somebody else* built. A collection
 * this server generated is already described by the rule that generated it, so
 * adopting it mints a second rule saying the same thing — and because the
 * generated collection is named after its rule, the pair is indistinguishable
 * in the rules list except that the copy is disabled and has never run.
 *
 * `Rule:<id>` is the load-bearing half: every generate run stamps it, and it is
 * what the sweep and delete paths key on. The bare `Tinkerbell` label is
 * checked too, but it is a weaker signal on its own — the label job puts it on
 * media items, so a user's hand-made smart collection *of* labelled items could
 * carry it without being ours.
 */
export function isTinkerbellOwned(input: CollectionInput): boolean {
  return input.labels.some((l) => l === "Tinkerbell" || l.startsWith("Rule:"));
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
