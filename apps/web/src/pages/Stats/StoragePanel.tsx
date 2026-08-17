import { trpc } from "#/trpc";
import ErrorState from "#components/ErrorState";
import { DistributionBar } from "./DistributionBar";
import styles from "#pages/Stats/Stats.module.css";
import { formatFileSize, formatNumber } from "#/format";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";

/**
 * How much room each library takes, and how much of that is actually known.
 *
 * The coverage line is not a disclaimer to be tidied away later. TV libraries
 * are measured now — the sync rolls episode sizes up onto their show — but a
 * total can still be short: an unmatched item, a show whose episodes Plex gave
 * no sizes for, a library last synced before the roll-up existed. Naming the
 * gap is what stops someone reading a partial figure as the whole, and stops a
 * bare "0 B" beside a library reading as "this library is empty".
 */
export function StoragePanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const storageQuery = trpc.stats.storage.useQuery();

  if (storageQuery.error) {
    return (
      <PanelShell title="Storage" dragHandle={dragHandle} dragProps={dragProps}>
        <ErrorState inline title="Couldn't load storage" onRetry={() => storageQuery.refetch()} />
      </PanelShell>
    );
  }

  const sections = storageQuery.data ?? [];
  if (sections.length === 0) return null;

  const total = sections.reduce((sum, s) => sum + s.bytes, 0);
  const unsized = sections.reduce((sum, s) => sum + s.unsized, 0);
  const known = sections.filter((s) => s.bytes > 0);

  return (
    <PanelShell title="Storage" dragHandle={dragHandle} dragProps={dragProps}>
      {total > 0 ? (
        <>
          <div className={styles.distRows}>
            <DistributionBar
              label={`${formatFileSize(total)} across ${known.length} librar${known.length === 1 ? "y" : "ies"}`}
              items={known.map((s) => ({ value: s.sectionTitle, count: s.bytes }))}
              formatLabel={(label) => label}
              formatCount={formatFileSize}
            />
          </div>
          {unsized > 0 && (
            <div className={styles.muted}>
              Not counted: {formatNumber(unsized)} item{unsized === 1 ? "" : "s"} of unknown size. Sizes are read during
              Sync Media, so anything indexed before the last run fills in on the next one.
            </div>
          )}
        </>
      ) : (
        <div className={styles.muted}>
          No file sizes known yet. They are read during Sync Media, so this fills in after the next run.
        </div>
      )}
    </PanelShell>
  );
}
