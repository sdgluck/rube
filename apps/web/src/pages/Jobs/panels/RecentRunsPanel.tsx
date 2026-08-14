import { useNavigate } from "react-router-dom";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import RelativeTime from "#components/RelativeTime";
import Spinner from "#components/Spinner";
import { EMPTY, formatDuration } from "#/format";
import styles from "#pages/Jobs/Jobs.module.css";
import { isRunActive } from "#pages/Jobs/shared/useRunLog";
import { useJobsData } from "#pages/Jobs/useJobsData";

interface RecentRun {
  id: string;
  jobId: string;
  jobName: string;
  status: string;
  progress: number;
  startedAt: number;
  finishedAt: number | null;
}

interface RecentRunGroup {
  latest: RecentRun;
  count: number;
  minDurationMs: number;
  maxDurationMs: number;
}

/**
 * Roll up consecutive runs of the same (jobId, status) into a single group.
 * The most recent run wins for click navigation; we expose count + duration
 * range so the row can show "×N" and "1–2s".
 */
export function rollupRecentRuns(runs: RecentRun[]): RecentRunGroup[] {
  const out: RecentRunGroup[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    const finished = !isRunActive(run.status) && run.finishedAt != null;
    const dur = finished ? (run.finishedAt as number) - run.startedAt : 0;
    if (last && last.latest.jobId === run.jobId && last.latest.status === run.status && !isRunActive(run.status)) {
      last.count++;
      if (finished) {
        last.minDurationMs = Math.min(last.minDurationMs, dur);
        last.maxDurationMs = Math.max(last.maxDurationMs, dur);
      }
      continue;
    }
    out.push({ latest: run, count: 1, minDurationMs: dur, maxDurationMs: dur });
  }
  return out;
}

function formatGroupDuration(group: RecentRunGroup): string {
  if (isRunActive(group.latest.status)) return EMPTY;
  if (group.count === 1) return formatDuration(group.maxDurationMs);
  if (group.minDurationMs === group.maxDurationMs) return formatDuration(group.maxDurationMs);
  return `${formatDuration(group.minDurationMs)}–${formatDuration(group.maxDurationMs)}`;
}

export function RecentRunsPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const navigate = useNavigate();
  const { recentRunsQuery } = useJobsData();
  const runs = recentRunsQuery.data ?? [];

  return (
    <PanelShell title="Recent Runs" dragHandle={dragHandle} dragProps={dragProps}>
      {runs.length > 0 ? (
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th></th>
                <th>Job</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {rollupRecentRuns(runs).map((group) => {
                const run = group.latest;
                return (
                  <tr key={run.id} className={styles.clickableRow} onClick={() => navigate(`/jobs/runs/${run.id}`)}>
                    <td>
                      {isRunActive(run.status) ? (
                        <Spinner size="xs" />
                      ) : (
                        <span className={styles.statusDot} data-status={run.status} />
                      )}
                    </td>
                    <td className={styles.nameCell}>
                      <span className={styles.jobNameText}>{run.jobName}</span>
                      {group.count > 1 && <span className={styles.rollupBadge}>×{group.count}</span>}
                      {isRunActive(run.status) && run.progress > 0 && (
                        <div className={styles.miniProgress}>
                          <div
                            className={styles.miniProgressFill}
                            style={{ width: `${Math.round(run.progress * 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className={styles.monoCell}>
                      <RelativeTime timestamp={run.startedAt} />
                    </td>
                    <td className={styles.monoCell}>{formatGroupDuration(group)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.muted}>No recent runs</div>
      )}
    </PanelShell>
  );
}
