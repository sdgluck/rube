import { useEffect, useMemo, useRef, useState } from "react";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { trpc } from "#/trpc";
import styles from "#pages/Jobs/Jobs.module.css";
import { isRunActive, useRunLog } from "#pages/Jobs/shared/useRunLog";
import { useJobsData } from "#pages/Jobs/useJobsData";

export function RecentLogsPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { recentRunsQuery } = useJobsData();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // One tab per job — its latest run. Runs arrive newest-first.
  const latestRunPerJob = useMemo(() => {
    const seen = new Set<string>();
    return (recentRunsQuery.data ?? []).filter((r) => {
      if (seen.has(r.jobId)) return false;
      seen.add(r.jobId);
      return true;
    });
  }, [recentRunsQuery.data]);

  const selectedRunQuery = trpc.jobs.run.useQuery(
    { runId: selectedRunId! },
    {
      enabled: !!selectedRunId,
      refetchInterval: (query) => (isRunActive(query.state.data?.status) ? 1000 : false),
    },
  );
  const selectedLog = useRunLog(selectedRunId, isRunActive(selectedRunQuery.data?.status));

  useEffect(() => {
    if (!selectedRunId && latestRunPerJob.length > 0) setSelectedRunId(latestRunPerJob[0].id);
  }, [selectedRunId, latestRunPerJob]);

  if (latestRunPerJob.length === 0) return null;

  return (
    <PanelShell title="Recent Logs" dragHandle={dragHandle} dragProps={dragProps}>
      <div className={styles.logTabs}>
        {latestRunPerJob.map((run) => (
          <button
            key={run.id}
            className={`${styles.logTab} ${selectedRunId === run.id ? styles.logTabActive : ""}`}
            onClick={() => setSelectedRunId(run.id)}
          >
            <span className={styles.statusDot} data-status={run.status} />
            {run.jobName}
          </button>
        ))}
      </div>
      {selectedRunQuery.data ? (
        <div className={styles.logWrapper}>
          <button className={styles.logCopyBtn} onClick={() => navigator.clipboard.writeText(selectedLog)}>
            Copy
          </button>
          <pre ref={logRef} className={styles.logViewer}>
            {selectedLog || "(no output)"}
          </pre>
        </div>
      ) : selectedRunQuery.isLoading ? (
        <div className={styles.muted}>Loading log…</div>
      ) : null}
    </PanelShell>
  );
}
