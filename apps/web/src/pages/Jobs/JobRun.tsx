import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import { DetailSkeleton } from "#components/Skeleton";
import { BackLink } from "#components/PageShell";
import useSwipeBack from "#hooks/useSwipeBack";
import styles from "./Jobs.module.css";
import { formatDuration, formatElapsed } from "#/format";
import { isRunActive, useRunLog } from "./shared/useRunLog";

function formatEta(startMs: number, progress: number): string | null {
  if (progress <= 0 || progress >= 1) return null;
  const elapsed = Date.now() - startMs;
  const remaining = elapsed / progress - elapsed;
  if (remaining < 1000) return null;
  return `~${formatDuration(remaining)} remaining`;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "running" || status === "cancelling"
      ? styles.badgeRunning
      : status === "completed"
        ? styles.badgeCompleted
        : status === "failed"
          ? styles.badgeFailed
          : styles.badgeCancelled;
  // `cancelling` is a real, visible state: the cancel has been requested but
  // the command hasn't unwound yet, and pretending it's already gone would be
  // a lie the user can see through (the job is still occupied).
  return <span className={`${styles.badge} ${cls}`}>{status === "cancelling" ? "cancelling…" : status}</span>;
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
      refetchInterval: (query) => (isRunActive(query.state.data?.status) ? 1000 : false),
    },
  );

  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const run = runQuery.data;
  const log = useRunLog(runId, isRunActive(run?.status));

  const filteredLog = useMemo(() => {
    if (!log) return "";
    if (!filter && !errorsOnly) return log;
    const lines = log.split("\n");
    return lines
      .filter((line: string) => {
        if (errorsOnly && !ERROR_PATTERN.test(line)) return false;
        if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      })
      .join("\n");
  }, [log, filter, errorsOnly]);

  const isFiltering = !!(filter || errorsOnly);

  // Auto-scroll log
  useEffect(() => {
    if (autoScroll.current && logRef.current && !isFiltering) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, isFiltering]);

  // Track user scroll position
  const handleLogScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleDownload = () => {
    if (!log) return;
    const blob = new Blob([log], { type: "text/plain" });
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
      <BackLink to={`/jobs/${run.jobId}`} parent="Job">
        Run
      </BackLink>

      <div className={styles.runHeader}>
        <StatusBadge status={run.status} />
        {run.status === "running" && (
          // Only a `running` run can be cancelled — one already `cancelling`
          // has been asked and is unwinding.
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
        {log && (
          <>
            <button className={styles.logToolbarBtn} onClick={() => navigator.clipboard.writeText(log)}>
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
