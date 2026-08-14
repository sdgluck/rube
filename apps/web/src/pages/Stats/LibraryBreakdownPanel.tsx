import { trpc } from "#/trpc";
import ErrorState from "#components/ErrorState";
import { DistributionBar, RESOLUTION_COLORS } from "./DistributionBar";
import styles from "#pages/Stats/Stats.module.css";
import { formatCodec, formatResolution } from "#/format";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";

export function LibraryBreakdownPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const overviewQuery = trpc.stats.overview.useQuery();

  if (overviewQuery.error) {
    return (
      <PanelShell title="Library Breakdown" dragHandle={dragHandle} dragProps={dragProps}>
        <ErrorState inline title="Couldn't load library breakdown" onRetry={() => overviewQuery.refetch()} />
      </PanelShell>
    );
  }
  if (!overviewQuery.data || overviewQuery.data.totalItems === 0) return null;

  return (
    <PanelShell title="Library Breakdown" dragHandle={dragHandle} dragProps={dragProps}>
      <div className={styles.distRows}>
        <DistributionBar
          label="Resolution"
          items={overviewQuery.data.resolutions}
          colorMap={RESOLUTION_COLORS}
          formatLabel={formatResolution}
        />
        <DistributionBar label="Video Codec" items={overviewQuery.data.videoCodecs} formatLabel={formatCodec} />
        <DistributionBar label="Audio Codec" items={overviewQuery.data.audioCodecs} formatLabel={formatCodec} />
      </div>
    </PanelShell>
  );
}
