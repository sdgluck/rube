import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../trpc";
import styles from "./Jobs.module.css";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDuration(startMs: number, endMs?: number | null): string {
  const diff = (endMs || Date.now()) - startMs;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function describeCron(expr: string): string {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (hour === "*" && min === "0") return "Every hour";
    if (hour !== "*") return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return expr;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const cls =
    status === "running"
      ? styles.badgeRunning
      : status === "completed"
        ? styles.badgeCompleted
        : status === "failed"
          ? styles.badgeFailed
          : styles.badgeCancelled;
  return <span className={`${styles.badge} ${cls}`}>{status}</span>;
}

export default function Jobs() {
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [editingCron, setEditingCron] = useState<Record<string, string>>({});
  const [cronErrors, setCronErrors] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const runsQuery = trpc.jobs.runs.useQuery(
    { jobId: expandedJob!, limit: 10 },
    { enabled: !!expandedJob, refetchInterval: 3000 },
  );

  const hasRunning = jobsQuery.data?.some((j) => j.last_run_status === "running");

  useEffect(() => {
    if (hasRunning) {
      const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
      return () => clearInterval(interval);
    }
  }, [hasRunning, utils]);

  const startMutation = trpc.jobs.start.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const handleCronBlur = useCallback(
    (jobId: string) => {
      const value = editingCron[jobId];
      if (value === undefined) return;
      updateMutation.mutate(
        { jobId, schedule: value },
        {
          onError: (err) => {
            setCronErrors((prev) => ({ ...prev, [jobId]: err.message }));
          },
          onSuccess: () => {
            setEditingCron((prev) => {
              const next = { ...prev };
              delete next[jobId];
              return next;
            });
            setCronErrors((prev) => {
              const next = { ...prev };
              delete next[jobId];
              return next;
            });
          },
        },
      );
    },
    [editingCron, updateMutation],
  );

  const handleToggleEnabled = useCallback(
    (jobId: string, currentEnabled: number) => {
      updateMutation.mutate({ jobId, enabled: !currentEnabled });
    },
    [updateMutation],
  );

  if (jobsQuery.isLoading) return <p>Loading...</p>;
  if (jobsQuery.error) return <p>Error: {jobsQuery.error.message}</p>;

  const jobs = jobsQuery.data ?? [];

  return (
    <div>
      <h1 className={styles.heading}>Jobs</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Schedule</th>
            <th>Enabled</th>
            <th>Last Run</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <>
              <tr
                key={job.id}
                className={styles.clickableRow}
                onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
              >
                <td>{job.name}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    className={styles.cronInput}
                    value={editingCron[job.id] ?? job.schedule}
                    onChange={(e) => {
                      setEditingCron((prev) => ({ ...prev, [job.id]: e.target.value }));
                      setCronErrors((prev) => {
                        const next = { ...prev };
                        delete next[job.id];
                        return next;
                      });
                    }}
                    onBlur={() => handleCronBlur(job.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <div className={`${styles.cronHint} ${cronErrors[job.id] ? styles.cronError : ""}`}>
                    {cronErrors[job.id] || describeCron(editingCron[job.id] ?? job.schedule)}
                  </div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className={styles.toggle}
                    checked={!!job.enabled}
                    onChange={() => handleToggleEnabled(job.id, job.enabled)}
                  />
                </td>
                <td>
                  {job.last_run_status ? (
                    <span>
                      <StatusBadge status={job.last_run_status} />{" "}
                      <span className={styles.runMeta}>{formatTime(job.last_run_started_at!)}</span>
                    </span>
                  ) : (
                    <span className={styles.runMeta}>Never</span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`${styles.button} ${styles.buttonSmall}`}
                    disabled={job.last_run_status === "running" || startMutation.isPending}
                    onClick={() => startMutation.mutate({ jobId: job.id })}
                  >
                    Run Now
                  </button>
                </td>
              </tr>
              {expandedJob === job.id && (
                <tr key={`${job.id}-runs`}>
                  <td colSpan={5} className={styles.runsContainer}>
                    {runsQuery.isLoading ? (
                      <p>Loading runs...</p>
                    ) : runsQuery.data && runsQuery.data.length > 0 ? (
                      <ul className={styles.runsList}>
                        {runsQuery.data.map((run) => (
                          <li key={run.id} className={styles.runItem}>
                            <StatusBadge status={run.status} />
                            <Link to={`/jobs/runs/${run.id}`} className={styles.runLink}>
                              View Log
                            </Link>
                            <span className={styles.runMeta}>
                              {formatTime(run.started_at)} &middot; {formatDuration(run.started_at, run.finished_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.noRuns}>No runs yet</p>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
