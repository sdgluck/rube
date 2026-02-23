import { useRef, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { trpc } from "../trpc";
import { formatTime } from "../utils";
import styles from "./Jobs.module.css";

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

function formatEta(startMs: number, progress: number): string | null {
  if (progress <= 0 || progress >= 1) return null;
  const elapsed = Date.now() - startMs;
  const remaining = elapsed / progress - elapsed;
  const secs = Math.ceil(remaining / 1000);
  if (secs <= 0) return null;
  if (secs < 60) return `~${secs}s remaining`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `~${mins}m ${remSecs}s remaining`;
  const hours = Math.floor(mins / 60);
  return `~${hours}h ${mins % 60}m remaining`;
}

function StatusBadge({ status }: { status: string }) {
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

export default function JobRun() {
  const { runId } = useParams<{ runId: string }>();
  const logRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);

  const runQuery = trpc.jobs.run.useQuery(
    { runId: runId! },
    {
      enabled: !!runId,
      refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
    },
  );

  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const run = runQuery.data;

  // Auto-scroll log
  useEffect(() => {
    if (autoScroll.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [run?.log]);

  // Track user scroll position
  const handleLogScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  if (runQuery.isLoading) return <p>Loading...</p>;
  if (runQuery.error) return <p>Error: {runQuery.error.message}</p>;
  if (!run) return <p>Run not found</p>;

  return (
    <div className={styles.runDetail}>
      <Link to={`/jobs/${run.jobId}`} className={styles.backLink}>
        &larr; Back to Job
      </Link>

      <div className={styles.runHeader}>
        <h1 className={styles.runTitle}>Job Run</h1>
        <StatusBadge status={run.status} />
        {run.status === "running" && (
          <button
            className={`${styles.button} ${styles.buttonDanger}`}
            onClick={() => cancelMutation.mutate({ runId: run.id })}
            disabled={cancelMutation.isPending}
          >
            Cancel
          </button>
        )}
      </div>

      <div className={styles.metaGrid}>
        <span className={styles.metaLabel}>Started</span>
        <span>{formatTime(run.startedAt)}</span>
        {run.finishedAt && (
          <>
            <span className={styles.metaLabel}>Finished</span>
            <span>{formatTime(run.finishedAt)}</span>
          </>
        )}
        <span className={styles.metaLabel}>Duration</span>
        <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
        {run.status === "running" &&
          run.progress > 0 &&
          (() => {
            const eta = formatEta(run.startedAt, run.progress);
            return eta ? (
              <>
                <span className={styles.metaLabel}>ETA</span>
                <span>{eta}</span>
              </>
            ) : null;
          })()}
        {run.message && (
          <>
            <span className={styles.metaLabel}>Status</span>
            <span>{run.message}</span>
          </>
        )}
      </div>

      {run.status === "running" && run.progress > 0 && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.round(run.progress * 100)}%` }} />
        </div>
      )}

      <div className={styles.logWrapper}>
        {run.log && (
          <button className={styles.logCopyBtn} onClick={() => navigator.clipboard.writeText(run.log)}>
            Copy
          </button>
        )}
        <pre ref={logRef} className={styles.logViewer} onScroll={handleLogScroll}>
          {run.log || "(no output yet)"}
        </pre>
      </div>
    </div>
  );
}
