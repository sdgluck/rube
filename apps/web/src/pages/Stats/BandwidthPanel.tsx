import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import ErrorState from "#components/ErrorState";
import { SkeletonBlock } from "#components/Skeleton";
import styles from "#pages/Stats/Stats.module.css";
import { formatBandwidth, formatMbps, formatRelativeShort } from "#/format";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { BarChart } from "./BarChart";

/** `9pm` for the bucket `hoursAgo` hours back from the current hour. */
function hourLabel(hoursAgo: number): string {
  const date = new Date();
  date.setHours(date.getHours() - hoursAgo, 0, 0, 0);
  const hour = date.getHours();
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * A day of streaming demand, in hourly peaks.
 *
 * Peaks rather than averages, which is `getBandwidthSeries`' choice and the
 * right one here: an hour averaging 4 Mbps because one 40 Mbps stream ran for
 * six minutes is an hour in which the connection was nearly saturated, and the
 * average is the one number that hides it.
 *
 * The capacity line comes from the last bandwidth test, so the chart can say
 * how close the peaks came to the ceiling rather than leaving "38 Mbps" to mean
 * whatever the reader assumes about their upload speed.
 */
export function BandwidthPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const usageQuery = trpc.bandwidth.usage.useQuery(
    { hours: 24, buckets: 24 },
    // A bucket is an hour wide; anything faster redraws an identical chart.
    { refetchInterval: 60_000, refetchOnWindowFocus: false },
  );
  const latestQuery = trpc.bandwidth.latest.useQuery(undefined, { refetchOnWindowFocus: false });

  const values = usageQuery.data ?? [];
  const peak = values.length > 0 ? Math.max(...values) : 0;
  const capacity = latestQuery.data?.upMbps ?? 0;
  // The series is in kbps, the measured capacity in Mbps.
  const peakMbps = peak / 1000;

  return (
    <PanelShell
      title="Bandwidth"
      meta={peak > 0 ? `peak ${formatBandwidth(peak)}` : undefined}
      lede="Streaming demand over the last 24 hours, as the highest rate seen in each hour."
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {usageQuery.isLoading && <SkeletonBlock width="100%" height={104} />}
      {usageQuery.error && <ErrorState inline title="Couldn't load bandwidth" onRetry={() => usageQuery.refetch()} />}
      {usageQuery.data && peak === 0 && (
        <div className={styles.muted}>
          Nothing has streamed in the last 24 hours. Usage is sampled while sessions are playing, so this fills in the
          next time someone watches something.
        </div>
      )}
      {usageQuery.data && peak > 0 && (
        <>
          <BarChart
            values={values}
            labelFor={(i) => (i % 6 === 0 || i === values.length - 1 ? hourLabel(values.length - 1 - i) : null)}
            captionFor={(i, value) => `${hourLabel(values.length - 1 - i)}: peak ${formatBandwidth(value)}`}
            highlight={(i) => i === values.length - 1}
          />
          <div className={styles.factRow}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>24h peak</span>
              <span className={styles.factValue}>{formatBandwidth(peak)}</span>
            </span>
            {capacity > 0 ? (
              <>
                <span className={styles.fact}>
                  <span className={styles.factLabel}>Upload capacity</span>
                  <span className={styles.factValue}>{formatMbps(capacity)}</span>
                </span>
                <span className={styles.fact}>
                  <span className={styles.factLabel}>Peak used</span>
                  <span className={styles.factValue}>{Math.round((peakMbps / capacity) * 100)}%</span>
                </span>
              </>
            ) : (
              <span className={styles.fact}>
                <span className={styles.factLabel}>Upload capacity</span>
                <span className={styles.factValue}>
                  <Link to="/settings/bandwidth" className={styles.eventLink}>
                    Test bandwidth
                  </Link>
                </span>
              </span>
            )}
          </div>
          {/* Past a month the measured ceiling is a claim about the past, and
              the percentage above inherits that. Say when it was made. */}
          {latestQuery.data && latestQuery.data.staleDays > 30 && (
            <div className={styles.muted}>
              Capacity was measured {formatRelativeShort(latestQuery.data.startedAt)}. Re-run the test from{" "}
              <Link to="/settings/bandwidth" className={styles.eventLink}>
                Settings → Bandwidth
              </Link>{" "}
              if your connection has changed since.
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
}
