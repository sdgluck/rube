import type { MigrationPlan } from "@tinkerbell/migrate";
import { createProviderRegistry } from "./registry.ts";
import { createLegacyConfig } from "./legacy-config.ts";
import type { Db } from "@tinkerbell/db";
import type { MigrationStatus, ProviderRuntime, ProviderScanResult, ProviderStatus } from "./runtime.ts";
import { type ConfigStore } from "@tinkerbell/core";
import { token } from "@tinkerbell/container";

export type { ProviderRuntime, ProviderScanResult, ProviderStatus, MigrationStatus } from "./runtime.ts";

export interface MigrationDeps {
  db: Db;
  config: ConfigStore;
}
export function createMigration(deps: MigrationDeps) {
  const { getProvider, listProviders } = createProviderRegistry(deps);
  const { migrateLegacyKometaConfig } = createLegacyConfig(deps);

  async function buildProviderPlan(providerId: string): Promise<MigrationPlan> {
    return getProvider(providerId).buildPlan();
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
  };
}

export type Migration = ReturnType<typeof createMigration>;

export const MigrationToken = token<Migration>("migration");
