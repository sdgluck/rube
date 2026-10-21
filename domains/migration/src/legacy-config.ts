import { type ConfigStore } from "@rube/core";

export interface LegacyConfigDeps {
  config: ConfigStore;
}
export function createLegacyConfig(deps: LegacyConfigDeps) {
  /**
   * Fold pre-multi-provider config slots (`migration_kometa_*`) into the new
   * `migration_*` provider-keyed slots. Idempotent at the row level (old
   * keys are deleted once read) but we also gate it behind a module-level
   * flag so the four `getConfig` lookups don't run on every status fetch.
   */
  let migrated = false;

  const { getConfig, setConfig, deleteConfig } = deps.config;

  function migrateLegacyKometaConfig(): void {
    if (migrated) return;
    migrated = true;
    runMigration();
  }

  function runMigration(): void {
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

  return { migrateLegacyKometaConfig };
}
