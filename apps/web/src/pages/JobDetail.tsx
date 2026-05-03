import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc } from "../trpc";
import { describeCron } from "../utils";
import RelativeTime from "../RelativeTime";
import { DetailSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";
import ToggleSwitch from "../ToggleSwitch";
import UnsavedBanner from "../UnsavedBanner";
import useUnsavedChanges from "../useUnsavedChanges";
import useSwipeBack from "../useSwipeBack";
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

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const [editingCron, setEditingCron] = useState<string | undefined>(undefined);
  const [cronError, setCronError] = useState<string | undefined>(undefined);
  const logRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);

  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const runsQuery = trpc.jobs.runs.useQuery({ jobId: jobId!, limit: 10 }, { enabled: !!jobId, refetchInterval: 3000 });
  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });

  const job = jobsQuery.data?.find((j) => j.id === jobId);

  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [limit, setLimit] = useState<number>(10);
  const [configDirty, setConfigDirty] = useState(false);

  // Sync config state when job data loads
  useEffect(() => {
    if (job) {
      const parsed = (() => {
        try {
          return JSON.parse(job.config || "{}");
        } catch {
          return {};
        }
      })();
      setSelectedSections(parsed.sections || []);
      setLimit(parsed.limit ?? 10);
      setConfigDirty(false);
    }
  }, [job?.config, job?.command]);

  useUnsavedChanges(configDirty);

  const hasLimit = job?.command === "because-you-watched";
  const maxLimit = 20;
  const sections = sectionsQuery.data;

  const latestRunId = runsQuery.data?.[0]?.id;

  const latestRunQuery = trpc.jobs.run.useQuery(
    { runId: latestRunId! },
    {
      enabled: !!latestRunId,
      refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
    },
  );

  const startMutation = trpc.jobs.start.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      utils.jobs.runs.invalidate();
    },
  });

  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => {
      utils.jobs.runs.invalidate();
      latestRunQuery.refetch();
    },
  });

  const isRunning = job?.lastRunStatus === "running";

  useEffect(() => {
    if (isRunning) {
      const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
      return () => clearInterval(interval);
    }
  }, [isRunning, utils]);

  // Auto-scroll log
  useEffect(() => {
    if (autoScroll.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [latestRunQuery.data?.log]);

  const handleLogScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleCronBlur = useCallback(() => {
    if (editingCron === undefined || !jobId) return;
    updateMutation.mutate(
      { jobId, schedule: editingCron },
      {
        onError: (err) => setCronError(err.message),
        onSuccess: () => {
          setEditingCron(undefined);
          setCronError(undefined);
        },
      },
    );
  }, [editingCron, jobId, updateMutation]);

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      if (!job) return;
      updateMutation.mutate({ jobId: job.id, enabled: checked });
    },
    [job, updateMutation],
  );

  const handleSaveConfig = useCallback(() => {
    if (!jobId) return;
    const config: Record<string, unknown> = {};
    if (selectedSections.length > 0) config.sections = selectedSections;
    if (hasLimit) config.limit = limit;
    updateMutation.mutate({ jobId, config }, { onSuccess: () => setConfigDirty(false) });
  }, [jobId, selectedSections, hasLimit, limit, updateMutation]);

  if (jobsQuery.isLoading) return <DetailSkeleton />;
  if (!job) return <p>Job not found</p>;

  const latestRun = latestRunQuery.data;

  return (
    <div ref={swipeRef} className={styles.jobDetail}>
      <Link to="/jobs" className={styles.backLink}>
        &larr; Back to Jobs
      </Link>

      <div className={styles.jobDetailHeader}>
        <h1 className={styles.heading}>{job.name}</h1>
        <button
          className={`${styles.button}`}
          disabled={isRunning || startMutation.isPending}
          onClick={() => startMutation.mutate({ jobId: job.id })}
        >
          {isRunning ? "Running..." : "Run Now"}
        </button>
        {isRunning && latestRun && (
          <button
            className={`${styles.button} ${styles.buttonDanger}`}
            onClick={() => cancelMutation.mutate({ runId: latestRun.id })}
            disabled={cancelMutation.isPending}
          >
            Cancel
          </button>
        )}
      </div>

      <div className={styles.jobDetailColumns}>
        {/* Config section */}
        <fieldset
          className={job.command !== "purge-runs" ? styles.detailSectionCappedWithFooter : styles.detailSectionCapped}
        >
          <legend className={styles.detailSectionTitle}>Configuration</legend>
          <div className={styles.detailSectionScroll}>
            <table className={styles.configTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Input</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Schedule</td>
                  <td>
                    <input
                      className={styles.cronInput}
                      value={editingCron ?? job.schedule}
                      onChange={(e) => {
                        setEditingCron(e.target.value);
                        setCronError(undefined);
                      }}
                      onBlur={handleCronBlur}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                  <td>
                    <span className={cronError ? styles.cronError : styles.configSummary}>
                      {cronError || describeCron(editingCron ?? job.schedule) || "No schedule"}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Enabled</td>
                  <td>
                    <ToggleSwitch size="sm" checked={!!job.enabled} onChange={handleToggleEnabled} />
                  </td>
                  <td className={styles.configSummary}>{job.enabled ? "Yes" : "No"}</td>
                </tr>
                {job.command !== "purge-runs" && (
                  <tr>
                    <td>Sections</td>
                    <td>
                      {sections && sections.length > 0 ? (
                        <div className={styles.configSections}>
                          {sections.map((s) => (
                            <label key={s.key} className={styles.configSectionItem}>
                              <input
                                type="checkbox"
                                checked={selectedSections.includes(s.title)}
                                onChange={() => {
                                  setSelectedSections((prev) =>
                                    prev.includes(s.title) ? prev.filter((t) => t !== s.title) : [...prev, s.title],
                                  );
                                  setConfigDirty(true);
                                }}
                              />
                              <span>{s.title}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.configHint}>Configure Plex first</span>
                      )}
                    </td>
                    <td className={styles.configSummary}>
                      {selectedSections.length > 0 ? selectedSections.join(", ") : "All sections"}
                    </td>
                  </tr>
                )}
                {job.command === "generate" && (
                  <tr>
                    <td>Rules</td>
                    <td colSpan={2}>
                      <Link to="/rules">Manage rules &rarr;</Link>
                    </td>
                  </tr>
                )}
                {hasLimit && (
                  <tr>
                    <td>Limit</td>
                    <td>
                      <input
                        type="number"
                        className={styles.configNumberInput}
                        min={1}
                        max={maxLimit}
                        value={limit}
                        onChange={(e) => {
                          setLimit(Math.max(1, Math.min(maxLimit, parseInt(e.target.value, 10) || 1)));
                          setConfigDirty(true);
                        }}
                      />
                    </td>
                    <td className={styles.configSummary}>
                      {limit} collection{limit !== 1 ? "s" : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {job.command !== "purge-runs" && (
            <div className={styles.detailSectionFooter}>
              <button
                className={`${styles.button} ${styles.buttonSmall}`}
                onClick={handleSaveConfig}
                disabled={!configDirty}
              >
                Save Config
              </button>
              <UnsavedBanner visible={configDirty} />
            </div>
          )}
        </fieldset>

        {/* Run history section */}
        <fieldset className={styles.detailSectionCapped}>
          <legend className={styles.detailSectionTitle}>Run History</legend>
          {runsQuery.isLoading ? (
            <p>Loading runs...</p>
          ) : runsQuery.data && runsQuery.data.length > 0 ? (
            <div className="table-scroll">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {runsQuery.data.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className={styles.runMeta}>
                        <RelativeTime timestamp={run.startedAt} />
                      </td>
                      <td className={styles.runMeta}>{formatDuration(run.startedAt, run.finishedAt)}</td>
                      <td>
                        <Link to={`/jobs/runs/${run.id}`} className={styles.runLink}>
                          View Log
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="list" title="No runs yet" />
          )}
        </fieldset>
      </div>

      {/* Latest run log section */}
      {latestRun && (
        <fieldset className={styles.detailSection}>
          <legend className={styles.detailSectionTitle}>
            Latest Run Log
            {latestRun.status === "running" && latestRun.progress > 0 && (
              <span className={styles.runMeta}> — {Math.round(latestRun.progress * 100)}%</span>
            )}
          </legend>
          {latestRun.status === "running" && latestRun.progress > 0 && (
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${Math.round(latestRun.progress * 100)}%` }} />
            </div>
          )}
          <div className={styles.logWrapper}>
            {latestRun.log && (
              <button className={styles.logCopyBtn} onClick={() => navigator.clipboard.writeText(latestRun.log)}>
                Copy
              </button>
            )}
            <pre ref={logRef} className={styles.logViewer} onScroll={handleLogScroll}>
              {latestRun.log || "(no output yet)"}
            </pre>
          </div>
        </fieldset>
      )}
    </div>
  );
}
