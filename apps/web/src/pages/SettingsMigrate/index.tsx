import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "#pages/Settings/SettingsPageHeader";
import styles from "#pages/Settings/Settings.module.css";
import ProviderPanel from "./ProviderPanel.tsx";

/**
 * Settings → Migrate page. Renders one tab per registered migration
 * provider; the per-provider plan UI lives in `ProviderPanel`. Default
 * tab is whichever provider currently has detected items, falling back
 * to the first registered one when nothing's been scanned yet.
 */
export default function SettingsMigrate() {
  const providersQuery = trpc.migration.providers.useQuery(undefined, { refetchOnWindowFocus: false });
  const statusQuery = trpc.migration.status.useQuery(undefined, { refetchOnWindowFocus: false });

  const [providerId, setProviderId] = useState<string | null>(null);

  useEffect(() => {
    if (providerId) return;
    const providers = providersQuery.data;
    if (!providers || providers.length === 0) return;
    const status = statusQuery.data;
    const firstWithItems = status?.providers.find((p) => p.count > 0)?.id;
    setProviderId(firstWithItems ?? providers[0].id);
  }, [providersQuery.data, statusQuery.data, providerId]);

  if (providersQuery.isLoading) return <FormSkeleton rows={5} />;
  if (providersQuery.error || !providersQuery.data) {
    return <div className={`${styles.toast} ${styles.error}`}>Failed to load migration providers</div>;
  }

  const providers = providersQuery.data;
  if (providers.length === 0) {
    return <p className={styles.hint}>No migration providers registered.</p>;
  }

  return (
    <div className={styles.form} style={{ maxWidth: 880 }}>
      <SettingsPageHeader
        title="Migrate"
        description="Import existing collections from other tools (e.g. Kometa) into Tinkerbell rules."
      />
      {providers.length > 1 && (
        <nav className={styles.subTabs}>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.subTab} ${p.id === providerId ? styles.subTabActive : ""}`}
              onClick={() => setProviderId(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
      )}
      {providerId && (
        <ProviderPanel
          providerId={providerId}
          providerLabel={providers.find((p) => p.id === providerId)?.label ?? providerId}
        />
      )}
    </div>
  );
}
