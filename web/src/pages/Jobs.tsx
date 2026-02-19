import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import styles from "./Jobs.module.css";

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

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export default function Jobs() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });

  const hasRunning = jobsQuery.data?.some((j) => j.lastRunStatus === "running");

  useEffect(() => {
    if (hasRunning) {
      const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
      return () => clearInterval(interval);
    }
  }, [hasRunning, utils]);

  if (jobsQuery.isLoading) return <p>Loading...</p>;
  if (jobsQuery.error) return <p>Error: {jobsQuery.error.message}</p>;

  const jobs = jobsQuery.data ?? [];

  return (
    <div>
      <h1 className={styles.heading}>Jobs{jobs.length > 0 && <span className="count-badge">{jobs.length}</span>}</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Schedule</th>
            <th>Enabled</th>
            <th>Last Run</th>
            <th>Last Run Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className={styles.clickableRow} onClick={() => navigate(`/jobs/${job.id}`)}>
              <td>{job.name}</td>
              <td>
                <span className={styles.cronText}>{job.schedule || "—"}</span>
                {job.schedule && <div className={styles.cronHint}>{describeCron(job.schedule)}</div>}
              </td>
              <td>{job.enabled ? "Yes" : "No"}</td>
              <td>
                <span className={styles.runMeta}>
                  {job.lastRunStartedAt ? formatTime(job.lastRunStartedAt) : "Never"}
                </span>
              </td>
              <td>{job.lastRunStatus ? <StatusBadge status={job.lastRunStatus} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
