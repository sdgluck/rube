import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import { DetailSkeleton } from "#components/Skeleton";
import { PageCrumbs } from "#layout/AppBar";
import StatusBadge from "./shared/StatusBadge";
import useSwipeBack from "#hooks/useSwipeBack";
import styles from "./Jobs.module.css";
import RunLog from "#components/RunLog";
import { formatDuration, formatElapsed } from "#/format";
import { isRunActive, useRunLog } from "./shared/useRunLog";

function formatEta(startMs: number, progress: number): string | null {
  if (progress <= 0 || progress >= 1) return null;
  const elapsed = Date.now() - startMs;
  const remaining = elapsed / progress - elapsed;
  if (remaining < 1000) return null;
  return `~${formatDuration(remaining)} remaining`;
}

export default function JobRun() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);

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

  if (runQuery.isLoading) return <DetailSkeleton />;
  if (runQuery.error) return <p>Error: {runQuery.error.message}</p>;
  if (!run) return <p>Run not found</p>;

  return (
    <div ref={swipeRef} className={styles.runDetail}>
      <PageCrumbs
        crumbs={[{ label: run.jobName ?? run.jobId, to: `/jobs/${run.jobId}` }, { label: `Run ${run.id}` }]}
      />

      <div className={styles.runHeader}>
        <StatusBadge status={run.status} variant={run.variant} command={run.command ?? undefined} />
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
        {/* "Tinkerbell gave up on this run" and "the command threw" are
            different facts, and only the first one comes with a caveat: a
            command job runs in a worker thread we cannot actually interrupt,
            so a watchdog failure means the row is final and the work might
            not be. That used to be recoverable only by finding `[watchdog]`
            somewhere in a multi-megabyte log. */}
        {run.failureKind && (
          <>
            <span className={styles.metaLabel}>Failed by</span>
            <span>
              {run.failureKind === "watchdog"
                ? "Watchdog — over its time budget; a command job's work may still be running."
                : run.failureKind === "cancel-timeout"
                  ? "Cancellation timed out — it was asked to stop and never did."
                  : run.failureKind}
            </span>
          </>
        )}
      </div>

      {run.status === "running" && run.progress > 0 && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.round(run.progress * 100)}%` }} />
        </div>
      )}

      <RunLog log={log} downloadName={`job-run-${runId}.txt`} />
    </div>
  );
}
