import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "#pages/Settings/SettingsPageHeader";
import styles from "#pages/Settings/Settings.module.css";
import ProviderPanel from "./ProviderPanel.tsx";
import KometaImport from "./KometaImport";
import VerifyPanel from "./VerifyPanel";

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

    // "Which provider found something?" is the wrong first question for Kometa.
    // The collection scanner always reports a count — that's what detects a
    // Kometa install at all — while the config importer reports zero until a
    // file is handed over. Ranking by count therefore lands every Kometa user
    // on the weaker of the two migrations by default. So an ingest provider
    // wins whenever a scan-based one has found anything for it to improve on.
    const ingestProvider = providers.find((p) => p.ingest);
    const firstWithItems = status?.providers.find((p) => p.count > 0)?.id;
    setProviderId(ingestProvider?.id ?? firstWithItems ?? providers[0].id);
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
    <div className={styles.form} style={{ maxWidth: "88rem" }}>
      <SettingsPageHeader title="Migrate" />
      {providers.length > 1 && (
        <nav className={styles.subTabs} aria-label="Migration providers">
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
      {/*
        Sits above the provider tabs because it's about a migration that has
        already happened, not about choosing one — and because "did that work?"
        is the question somebody returning to this page has.
      */}
      <VerifyPanel />

      {/*
        A provider that declares `ingest` can't plan anything until the user
        hands it a file, so it gets the import wizard rather than the
        scan-and-propose panel every other provider shares.
      */}
      {providerId && providers.find((p) => p.id === providerId)?.ingest ? (
        <KometaImport
          providerId={providerId}
          // "I don't have my config" isn't a dead end: the title-scanning
          // Kometa provider is a worse migration but a real one.
          onFallbackToScan={() => setProviderId("kometa")}
        />
      ) : (
        providerId && (
          <ProviderPanel
            providerId={providerId}
            providerLabel={providers.find((p) => p.id === providerId)?.label ?? providerId}
          />
        )
      )}
    </div>
  );
}
