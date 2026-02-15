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

function JobConfigEditor({
  job,
  onSave,
  sections,
}: {
  job: { id: string; command: string; config: string };
  onSave: (config: Record<string, unknown>) => void;
  sections?: Array<{ key: string; title: string; type: string }>;
}) {
  const parsed = (() => {
    try {
      return JSON.parse(job.config || "{}");
    } catch {
      return {};
    }
  })();

  const [selectedSections, setSelectedSections] = useState<string[]>(parsed.sections || []);
  const [limit, setLimit] = useState<number>(parsed.limit ?? (job.command === "generate" ? 8 : 10));
  const [dirty, setDirty] = useState(false);

  const hasLimit = job.command === "generate" || job.command === "because-you-watched";
  const maxLimit = job.command === "generate" ? 10 : 20;

  const toggleSection = (title: string) => {
    setSelectedSections((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
    setDirty(true);
  };

  const handleSave = () => {
    const config: Record<string, unknown> = {};
    if (selectedSections.length > 0) {
      config.sections = selectedSections;
    }
    if (hasLimit) {
      config.limit = limit;
    }
    onSave(config);
    setDirty(false);
  };

  return (
    <div className={styles.configEditor}>
      <div className={styles.configField}>
        <span className={styles.configLabel}>Sections</span>
        {sections && sections.length > 0 ? (
          <div className={styles.configSections}>
            {sections.map((s) => (
              <label key={s.key} className={styles.configSectionItem}>
                <input
                  type="checkbox"
                  checked={selectedSections.includes(s.title)}
                  onChange={() => toggleSection(s.title)}
                />
                <span>{s.title}</span>
              </label>
            ))}
          </div>
        ) : (
          <span className={styles.configHint}>Configure Plex connection in Settings first</span>
        )}
        {selectedSections.length === 0 && sections && sections.length > 0 && (
          <span className={styles.configHint}>All sections (default)</span>
        )}
      </div>
      {hasLimit && (
        <div className={styles.configField}>
          <label className={styles.configLabel}>
            Limit
            <input
              type="number"
              className={styles.configNumberInput}
              min={1}
              max={maxLimit}
              value={limit}
              onChange={(e) => {
                setLimit(Math.max(1, Math.min(maxLimit, parseInt(e.target.value, 10) || 1)));
                setDirty(true);
              }}
            />
          </label>
        </div>
      )}
      <button className={`${styles.button} ${styles.buttonSmall}`} onClick={handleSave} disabled={!dirty}>
        Save Config
      </button>
    </div>
  );
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
  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });

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

  const handleSaveConfig = useCallback(
    (jobId: string, config: Record<string, unknown>) => {
      updateMutation.mutate({ jobId, config });
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
                <tr key={`${job.id}-detail`}>
                  <td colSpan={5} className={styles.runsContainer}>
                    {job.command !== "purge-runs" && (
                      <JobConfigEditor
                        job={job}
                        onSave={(config) => handleSaveConfig(job.id, config)}
                        sections={sectionsQuery.data}
                      />
                    )}
                    <div className={styles.runsSection}>
                      <h4 className={styles.runsTitle}>Run History</h4>
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
                    </div>
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
