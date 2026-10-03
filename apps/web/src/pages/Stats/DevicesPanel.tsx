import { trpc } from "#/trpc";
import ErrorState from "#components/ErrorState";
import { SkeletonBlock } from "#components/Skeleton";
import { DistributionBar } from "./DistributionBar";
import styles from "#pages/Stats/Stats.module.css";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";
import PanelEmpty from "./PanelEmpty";

/** Backfilled history carries no device or app — see `playbackBreakdown`. */
const labelFor = (value: string) => value || "Unknown";

/**
 * What people watch on.
 *
 * Two bars rather than one because they answer different questions: the app
 * ("Plex for Apple TV") is what decides whether a file can be direct-played,
 * and the device ("Living Room") is who is asking. A household with four
 * devices all running the same app looks identical on one bar and not the
 * other.
 */
export function DevicesPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { periodDays, setPeriodDays, label } = usePeriod(30);
  const breakdownQuery = trpc.stats.playbackBreakdown.useQuery({ periodDays });

  const data = breakdownQuery.data;

  return (
    <PanelShell
      title="Devices & Apps"
      actions={<PeriodSelector value={periodDays} onChange={setPeriodDays} />}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {breakdownQuery.isLoading && <SkeletonBlock width="100%" height={92} />}
      {breakdownQuery.error && (
        <ErrorState inline title="Couldn't load device breakdown" onRetry={() => breakdownQuery.refetch()} />
      )}
      {data && data.total === 0 && (
        <PanelEmpty>{periodDays === 0 ? "No plays yet" : `No plays in the last ${label}`}</PanelEmpty>
      )}
      {data && data.total > 0 && (
        <div className={styles.distRows}>
          <DistributionBar label="App" items={data.platforms} formatLabel={labelFor} />
          <DistributionBar label="Device" items={data.players} formatLabel={labelFor} />
        </div>
      )}
    </PanelShell>
  );
}
