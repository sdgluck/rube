import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import { DetailSkeleton } from "#components/Skeleton";
import useSwipeBack from "#hooks/useSwipeBack";
import styles from "./Jobs.module.css";
import { formatDuration, formatElapsed } from "#/format";

function formatEta(startMs: number, progress: number): string | null {
  if (progress <= 0 || progress >= 1) return null;
  const elapsed = Date.now() - startMs;
  const remaining = elapsed / progress - elapsed;
  if (remaining < 1000) return null;
  return `~${formatDuration(remaining)} remaining`;
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

const ERROR_PATTERN = /error|failed|exception|fatal|panic|ENOENT|ECONNREFUSED/i;

export default function JobRun() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const logRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);

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

  const filteredLog = useMemo(() => {
    if (!run?.log) return "";
    if (!filter && !errorsOnly) return run.log;
    const lines = run.log.split("\n");
    return lines
      .filter((line) => {
        if (errorsOnly && !ERROR_PATTERN.test(line)) return false;
        if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      })
      .join("\n");
  }, [run?.log, filter, errorsOnly]);

  const isFiltering = !!(filter || errorsOnly);

  // Auto-scroll log
  useEffect(() => {
    if (autoScroll.current && logRef.current && !isFiltering) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [run?.log, isFiltering]);

  // Track user scroll position
  const handleLogScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleDownload = () => {
    if (!run?.log) return;
    const blob = new Blob([run.log], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `job-run-${runId}.txt`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (runQuery.isLoading) return <DetailSkeleton />;
  if (runQuery.error) return <p>Error: {runQuery.error.message}</p>;
  if (!run) return <p>Run not found</p>;

  return (
    <div ref={swipeRef} className={styles.runDetail}>
      <Link to={`/jobs/${run.jobId}`} className={styles.backLink}>
        &larr; Back to Job
      </Link>

      <div className={styles.runHeader}>
        <h2 className={styles.runTitle}>Job Run</h2>
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
        <span>
          <RelativeTime timestamp={run.startedAt} />
        </span>
        {run.finishedAt && (
          <>
            <span className={styles.metaLabel}>Finished</span>
            <span>
              <RelativeTime timestamp={run.finishedAt} />
            </span>
          </>
        )}
        <span className={styles.metaLabel}>Duration</span>
        <span>{formatElapsed(run.startedAt, run.finishedAt)}</span>
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

      <div className={styles.logToolbar}>
        <input
          type="text"
          className={styles.logFilterInput}
          placeholder="Filter log…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className={styles.logErrorToggle}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Errors only
        </label>
        {run.log && (
          <>
            <button className={styles.logToolbarBtn} onClick={() => navigator.clipboard.writeText(run.log)}>
              Copy
            </button>
            <button className={styles.logToolbarBtn} onClick={handleDownload}>
              Download
            </button>
          </>
        )}
      </div>

      <div className={styles.logWrapper}>
        <pre ref={logRef} className={styles.logViewer} onScroll={handleLogScroll}>
          {filteredLog || (isFiltering ? "(no matching lines)" : "(no output yet)")}
        </pre>
      </div>
    </div>
  );
}
