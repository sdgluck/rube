import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { formatTimeUntil } from "#/format";
import { cronNextRuns, findScheduleCollisions } from "#lib/cron.ts";
import styles from "#pages/Jobs/Jobs.module.css";
import { useJobsData } from "#pages/Jobs/useJobsData";
import { trpc } from "#/trpc";

/** The next fire time of every enabled job with a schedule, soonest first. */
export function useUpcomingRuns(limit = 8) {
  const { rawJobs } = useJobsData();
  // The server evaluates every schedule in its configured zone, so "0 3 * * *"
  // means 3am *there*. This panel built its Cron without one and so read the
  // expression in the browser's zone — a user in a different one, or on a UTC
  // container, was shown a next-run time hours from when the job actually
  // fires. `CronPreview` already asked the same question the right way; this
  // now goes through the same helper rather than keeping a second idiom.
  const timezone = trpc.config.effectiveTimezone.useQuery(undefined, { staleTime: 5 * 60_000 }).data?.timezone;
  return useMemo(
    () =>
      rawJobs
        .filter((j) => j.enabled && j.schedule)
        .map((j) => ({
          name: j.name,
          jobId: j.id,
          nextRun: cronNextRuns(j.schedule, timezone, 1).next[0]?.getTime() ?? null,
        }))
        .filter((j): j is { name: string; jobId: string; nextRun: number } => j.nextRun != null)
        .sort((a, b) => a.nextRun - b.nextRun)
        .slice(0, limit),
    [rawJobs, limit, timezone],
  );
}

export function UpcomingPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const navigate = useNavigate();
  const upcoming = useUpcomingRuns();
  const collisions = useMemo(() => findScheduleCollisions(upcoming), [upcoming]);

  // Countdowns are computed, not pushed — re-render on a slow tick so "in 15m"
  // doesn't sit there going stale between job list refetches.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <PanelShell title="Upcoming" dragHandle={dragHandle} dragProps={dragProps}>
      {upcoming.length > 0 ? (
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Next Run</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((item) => (
                <tr key={item.jobId} className={styles.clickableRow} onClick={() => navigate(`/jobs/${item.jobId}`)}>
                  <td className={styles.nameCell}>
                    <span className={styles.jobNameText}>{item.name}</span>
                  </td>
                  {/* formatTimeUntil already says "in …" */}
                  <td className={styles.monoCell}>{formatTimeUntil(item.nextRun)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.muted}>No scheduled jobs</div>
      )}
      {collisions.map((names) => (
        <div key={names.join()} className={styles.muted}>
          {names.join(", ")} all start at the same minute — they run one after another, not together.
        </div>
      ))}
    </PanelShell>
  );
}
