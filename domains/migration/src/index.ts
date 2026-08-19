import type { MigrationPlan } from "@tinkerbell/migrate";
import { createProviderRegistry } from "./registry.ts";
import { createLegacyConfig } from "./legacy-config.ts";
import type { Db } from "@tinkerbell/db";
import type {
  BuildPlanInput,
  MigrationStatus,
  ProviderRuntime,
  ProviderScanResult,
  ProviderStatus,
} from "./runtime.ts";
import { type ConfigStore } from "@tinkerbell/core";
import { token } from "@tinkerbell/container";

export type {
  BuildPlanInput,
  MigrationStatus,
  ProviderIngest,
  ProviderRuntime,
  ProviderScanResult,
  ProviderStatus,
} from "./runtime.ts";

export interface MigrationDeps {
  db: Db;
  config: ConfigStore;
}
export function createMigration(deps: MigrationDeps) {
  const { getProvider, listProviders, kometaYaml } = createProviderRegistry(deps);
  const { migrateLegacyKometaConfig } = createLegacyConfig(deps);

  async function buildProviderPlan(providerId: string, input?: BuildPlanInput): Promise<MigrationPlan> {
    return getProvider(providerId).buildPlan(input);
  }
  const { getConfig, setConfig } = deps.config;

  /**
   * Re-scan source data for the given provider and persist the summary in
   * config. Async because some providers (MDBList, Trakt) hit external APIs.
   */
  async function scanProviderState(providerId: string): Promise<ProviderScanResult> {
    migrateLegacyKometaConfig();
    const runtime = getProvider(providerId);
    const result = await runtime.scan();
    const all = getConfig("migration_state") ?? {};
    setConfig("migration_state", { ...all, [providerId]: result });
    return result;
  }

  /**
   * Re-scan every registered provider that opts into auto-scanning. Called
   * from sync hooks. Providers whose `scan()` hits external APIs (MDBList,
   * Trakt) opt out and are only refreshed from explicit Settings actions.
   */
  async function scanAllProviders(): Promise<void> {
    for (const runtime of listProviders()) {
      if (!runtime.autoScan) continue;
      try {
        await scanProviderState(runtime.id);
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

  function getProviderStatus(providerId: string): ProviderStatus {
    migrateLegacyKometaConfig();
    return buildProviderStatus(getProvider(providerId));
  }

  function getMigrationStatus(): MigrationStatus {
    migrateLegacyKometaConfig();
    const providers = listProviders().map(buildProviderStatus);
    const totalCount = providers.reduce((sum, p) => sum + p.count, 0);
    const shouldShowBanner = providers.some((p) => p.shouldShowBanner);
    return { providers, totalCount, shouldShowBanner };
  }

  function dismissProvider(providerId: string): void {
    // Validate so callers can't silently write garbage provider ids.
    getProvider(providerId);
    const all = getConfig("migration_dismissed_at") ?? {};
    setConfig("migration_dismissed_at", { ...all, [providerId]: Date.now() });
  }

  function markProviderCompleted(providerId: string): void {
    getProvider(providerId);
    const all = getConfig("migration_completed_at") ?? {};
    setConfig("migration_completed_at", { ...all, [providerId]: Date.now() });
  }

  /**
   * Take a Kometa config bundle and stash it for review.
   *
   * The id is minted by the caller rather than here so the router can hand it
   * straight back to the UI, which needs it to address every subsequent step
   * of the wizard.
   */
  function createKometaImport(importId: string, files: Array<{ path: string; text: string }>): void {
    kometaYaml.saveImport(importId, files);
  }

  return {
    buildProviderPlan,
    listProviders,
    getProvider,
    migrateLegacyKometaConfig,
    scanProviderState,
    scanAllProviders,
    getProviderStatus,
    getMigrationStatus,
    dismissProvider,
    markProviderCompleted,
    // Ingest-side surface for the Kometa YAML provider. Not part of
    // `ProviderRuntime`: that describes scanning and planning, which is all
    // the collection-scanning providers do.
    createKometaImport,
    readKometaServerPath: kometaYaml.readServerPath,
    kometaOverlaysFor: kometaYaml.overlaysFor,
    kometaMetadataOverridesFor: kometaYaml.metadataOverridesFor,
    loadKometaImport: kometaYaml.loadImport,
    latestKometaImportId: kometaYaml.latestImportId,
    setKometaSectionMap: kometaYaml.setSectionMap,
    resolveKometaSections: kometaYaml.resolveSections,
    KOMETA_IMPORT_LIMITS: { maxFiles: kometaYaml.MAX_FILES, maxBytes: kometaYaml.MAX_TOTAL_BYTES },
  };
}

export type Migration = ReturnType<typeof createMigration>;

export const MigrationToken = token<Migration>("migration");
