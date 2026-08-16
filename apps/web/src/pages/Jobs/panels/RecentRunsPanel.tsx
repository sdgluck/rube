import { useNavigate } from "react-router-dom";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import RelativeTime from "#components/RelativeTime";
import Spinner from "#components/Spinner";
import { EMPTY, formatDuration } from "#/format";
import styles from "#pages/Jobs/Jobs.module.css";
import { isRunActive } from "#pages/Jobs/shared/useRunLog";
import { useJobsData } from "#pages/Jobs/useJobsData";
import { trpc } from "#/trpc";

/**
 * A manual rule run, in the shape this panel already understands.
 *
 * Rule runs belong here — running a rule by hand is an activity of exactly the
 * kind this panel lists, and until now the only trace it left was a status cell
 * on another page. Runs a job owns are excluded: the job's own row already
 * stands for them, and thirty per-rule rows would bury everything else.
 *
 * `jobId` is a synthetic `rule:<id>` key, which is what makes the existing
 * rollup collapse a rule run ten times in an afternoon into one "×10" row.
 */
function ruleRunsAsRecentRuns(runs: RuleRunRow[]): RecentRun[] {
  return runs
    .filter((run) => run.trigger === "manual")
    .map((run) => ({
      id: run.id,
      jobId: `rule:${run.ruleId}`,
      jobName: `${run.ruleName}${run.phase === "test" ? " (test)" : ""}`,
      status: RULE_STATUS_TO_JOB_STATUS[run.status] ?? run.status,
      progress: run.progress,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      href: `/rules/${run.ruleId}/runs?run=${run.id}`,
    }));
}

/** `.statusDot` is styled by job-run vocabulary; rule runs speak a shorter one. */
const RULE_STATUS_TO_JOB_STATUS: Record<string, string> = {
  queued: "running",
  running: "running",
  cancelling: "cancelling",
  ok: "completed",
  error: "failed",
  cancelled: "cancelled",
};

type RuleRunRow = {
  id: string;
  ruleId: string;
  ruleName: string;
  phase: string;
  trigger: string;
  status: string;
  progress: number;
  startedAt: number;
  finishedAt: number | null;
};

interface RecentRun {
  id: string;
  jobId: string;
  jobName: string;
  status: string;
  progress: number;
  startedAt: number;
  finishedAt: number | null;
  /** Where clicking the row goes. Defaults to the job run's own page. */
  href?: string;
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
  const ruleRunsQuery = trpc.rules.recentRuns.useQuery({ limit: 20 }, { refetchInterval: 3000 });
  // One list, newest first — the panel is about what happened recently, not
  // about which subsystem happened to do it.
  const runs = [...(recentRunsQuery.data ?? []), ...ruleRunsAsRecentRuns(ruleRunsQuery.data ?? [])].sort(
    (a, b) => b.startedAt - a.startedAt,
  );

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
                  <tr
                    key={run.id}
                    className={styles.clickableRow}
                    onClick={() => navigate(run.href ?? `/jobs/runs/${run.id}`)}
                  >
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
