import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cron } from "croner";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { formatTimeUntil } from "#/format";
import styles from "#pages/Jobs/Jobs.module.css";
import { useJobsData } from "#pages/Jobs/useJobsData";

/** The next fire time of every enabled job with a schedule, soonest first. */
export function useUpcomingRuns(limit = 8) {
  const { rawJobs } = useJobsData();
  return useMemo(
    () =>
      rawJobs
        .filter((j) => j.enabled && j.schedule)
        .map((j) => {
          try {
            const next = new Cron(j.schedule).nextRun();
            return { name: j.name, jobId: j.id, nextRun: next?.getTime() ?? null };
          } catch {
            return { name: j.name, jobId: j.id, nextRun: null };
          }
        })
        .filter((j): j is { name: string; jobId: string; nextRun: number } => j.nextRun != null)
        .sort((a, b) => a.nextRun - b.nextRun)
        .slice(0, limit),
    [rawJobs, limit],
  );
}

export function UpcomingPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const navigate = useNavigate();
  const upcoming = useUpcomingRuns();

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
    </PanelShell>
  );
}
