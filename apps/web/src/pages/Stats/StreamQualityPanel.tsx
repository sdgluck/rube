import { trpc } from "#/trpc";
import ErrorState from "#components/ErrorState";
import { SkeletonBlock } from "#components/Skeleton";
import { DistributionBar } from "./DistributionBar";
import styles from "#pages/Stats/Stats.module.css";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { playbackLabel } from "#lib/streamDecision";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";
import PanelEmpty from "./PanelEmpty";

/* The same ramp the other distributions use, but assigned by meaning rather
   than by rank: transcode is the expensive one wherever it lands in the order,
   and a bar whose colours move as the numbers do can't be read at a glance. */
const DECISION_COLORS: Record<string, string> = {
  directplay: "#12867c",
  copy: "#5cb8ae",
  transcode: "#c98a3f",
  "": "#c3cecc",
};

const LOCATION_COLORS: Record<string, string> = {
  local: "#5cb8ae",
  remote: "#12867c",
};

/**
 * How hard the server has been working, and for whom.
 *
 * The Transcodes tile says what is happening this second; this says what
 * normally happens. A server that transcodes four plays in five is a server
 * that needs a different library, not a bigger CPU — and that is a shape only
 * visible over a period.
 *
 * `local`/`remote` sits beside it because the two are usually the same story:
 * remote playback is where bandwidth limits force a transcode.
 */
export function StreamQualityPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { periodDays, setPeriodDays, label } = usePeriod(30);
  const breakdownQuery = trpc.stats.playbackBreakdown.useQuery({ periodDays });

  const data = breakdownQuery.data;
  const transcodes = data?.decisions.find((d) => d.value === "transcode")?.count ?? 0;
  // Denominator excludes rows that never recorded a decision — backfilled
  // history. A percentage of "known" is honest; a percentage of everything
  // would report a server as transcode-free because its history predates the
  // poller.
  const known = data?.decisions.filter((d) => d.value !== "").reduce((sum, d) => sum + d.count, 0) ?? 0;

  return (
    <PanelShell
      title="Stream Quality"
      meta={known > 0 ? `${Math.round((transcodes / known) * 100)}% transcoded` : undefined}
      actions={<PeriodSelector value={periodDays} onChange={setPeriodDays} />}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {breakdownQuery.isLoading && <SkeletonBlock width="100%" height={92} />}
      {breakdownQuery.error && (
        <ErrorState inline title="Couldn't load stream breakdown" onRetry={() => breakdownQuery.refetch()} />
      )}
      {data && data.total === 0 && (
        <PanelEmpty>{periodDays === 0 ? "No plays yet" : `No plays in the last ${label}`}</PanelEmpty>
      )}
      {data && data.total > 0 && (
        <>
          <div className={styles.distRows}>
            <DistributionBar
              label="Playback"
              items={data.decisions}
              colorMap={DECISION_COLORS}
              formatLabel={(value) => (value ? playbackLabel({ decision: value }, value) : "Unknown")}
              explain={(value) =>
                value ? undefined : "Imported from Plex history, which records no decision. Not in the % transcoded."
              }
            />
            <DistributionBar
              label="Location"
              items={data.locations}
              colorMap={LOCATION_COLORS}
              formatLabel={(value) => (value === "local" ? "Local" : "Remote")}
            />
          </div>
        </>
      )}
    </PanelShell>
  );
}
