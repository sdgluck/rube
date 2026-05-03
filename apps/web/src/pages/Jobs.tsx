import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Cron } from "croner";
import pMap from "p-map";
import { trpc } from "../trpc";
import { describeCron } from "../utils";
import RelativeTime from "../RelativeTime";
import DropdownButton from "../DropdownButton";
import { JobsSkeleton } from "../Skeleton";
import ToggleSwitch from "../ToggleSwitch";
import { useToast } from "../Toast";
import PullToRefresh from "../PullToRefresh";
import { readEnumStorage } from "../storage";
import styles from "./Jobs.module.css";
import shared from "./Collections.module.css";

// ─── Helpers ────────────────────────────────────────────────────────────────

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

interface RecentRun {
  id: string;
  jobId: string;
  jobName: string;
  status: string;
  progress: number;
  startedAt: number;
  finishedAt: number | null;
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
function rollupRecentRuns(runs: RecentRun[]): RecentRunGroup[] {
  const out: RecentRunGroup[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    const finished = run.status !== "running" && run.finishedAt != null;
    const dur = finished ? (run.finishedAt as number) - run.startedAt : 0;
    if (last && last.latest.jobId === run.jobId && last.latest.status === run.status && run.status !== "running") {
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

function formatDurationMs(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatGroupDuration(group: RecentRunGroup): string {
  if (group.latest.status === "running") return "—";
  if (group.count === 1) return formatDurationMs(group.maxDurationMs);
  if (group.minDurationMs === group.maxDurationMs) return formatDurationMs(group.maxDurationMs);
  return `${formatDurationMs(group.minDurationMs)}–${formatDurationMs(group.maxDurationMs)}`;
}

function formatTimeUntil(ms: number): string {
  const diff = ms - Date.now();
  if (diff < 0) return "now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

const SORT_KEYS = ["name", "schedule", "enabled", "lastRun", "lastRunStatus"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type SortDir = "asc" | "desc";

// ─── Main component ─────────────────────────────────────────────────────────

export default function Jobs() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const [, setTick] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const recentRunsQuery = trpc.jobs.recentRuns.useQuery(undefined, { refetchInterval: 3000 });
  const selectedRunQuery = trpc.jobs.run.useQuery(
    { runId: selectedRunId! },
    {
      enabled: !!selectedRunId,
      refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
    },
  );

  const updateMutation = trpc.jobs.update.useMutation({
    onMutate: async (input) => {
      await utils.jobs.list.cancel();
      const prev = utils.jobs.list.getData();
      if (prev && input.enabled !== undefined) {
        utils.jobs.list.setData(
          undefined,
          prev.map((j) => (j.id === input.jobId ? { ...j, enabled: input.enabled ? 1 : 0 } : j)),
        );
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) utils.jobs.list.setData(undefined, ctx.prev);
      addToast("Failed to update job", "error");
    },
    onSettled: () => utils.jobs.list.invalidate(),
  });

  const [sortKey, setSortKey] = useState<SortKey>(() => readEnumStorage("jobs-sort-key", SORT_KEYS, "name"));
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const stored = localStorage.getItem("jobs-sort-dir");
    return stored === "desc" ? "desc" : "asc";
  });

  const hasRunning = jobsQuery.data?.some((j) => j.lastRunStatus === "running");

  useEffect(() => {
    if (hasRunning) {
      const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
      return () => clearInterval(interval);
    }
  }, [hasRunning, utils]);

  // Auto-select first run when data loads
  useEffect(() => {
    if (!selectedRunId && recentRunsQuery.data && recentRunsQuery.data.length > 0) {
      setSelectedRunId(recentRunsQuery.data[0].id);
    }
  }, [selectedRunId, recentRunsQuery.data]);

  // Tick every 30s to update schedule timeline
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      const next = sortDir === "asc" ? "desc" : "asc";
      setSortDir(next);
      localStorage.setItem("jobs-sort-dir", next);
    } else {
      setSortKey(key);
      setSortDir("asc");
      localStorage.setItem("jobs-sort-key", key);
      localStorage.setItem("jobs-sort-dir", "asc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "");

  const rawJobs = jobsQuery.data ?? [];
  const jobs = [...rawJobs].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "schedule":
        cmp = (a.schedule || "").localeCompare(b.schedule || "");
        break;
      case "enabled":
        cmp = (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0);
        break;
      case "lastRun":
        cmp = (a.lastRunStartedAt ?? 0) - (b.lastRunStartedAt ?? 0);
        break;
      case "lastRunStatus":
        cmp = (a.lastRunStatus ?? "").localeCompare(b.lastRunStatus ?? "");
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // ─── Derived stats ──────────────────────────────────────────────────────
  const enabledCount = rawJobs.filter((j) => j.enabled).length;
  const runningCount = recentRunsQuery.data?.filter((r) => r.status === "running").length ?? 0;
  const lastFailure = rawJobs
    .filter((j) => j.lastRunStatus === "failed" && j.lastRunStartedAt)
    .sort((a, b) => (b.lastRunStartedAt ?? 0) - (a.lastRunStartedAt ?? 0))[0];

  // ─── Schedule timeline ──────────────────────────────────────────────────
  const upcoming = useMemo(() => {
    return rawJobs
      .filter((j) => j.enabled && j.schedule)
      .map((j) => {
        try {
          const next = new Cron(j.schedule).nextRun();
          return { name: j.name, jobId: j.id, nextRun: next?.getTime() ?? null };
        } catch {
          return { name: j.name, jobId: j.id, nextRun: null };
        }
      })
      .filter((j): j is { name: string; jobId: string; nextRun: number } => j.nextRun != null)
      .sort((a, b) => a.nextRun - b.nextRun)
      .slice(0, 8);
  }, [rawJobs]);

  // ─── Latest run per job (for log tabs) ─────────────────────────────────
  const latestRunPerJob = useMemo(() => {
    const runs = recentRunsQuery.data ?? [];
    const seen = new Set<string>();
    return runs.filter((r) => {
      if (seen.has(r.jobId)) return false;
      seen.add(r.jobId);
      return true;
    });
  }, [recentRunsQuery.data]);

  // ─── Export/Import ──────────────────────────────────────────────────────
  function getExportData() {
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      enabled: !!j.enabled,
      config: j.config ?? {},
    }));
  }

  function handleExportFile() {
    downloadJson(getExportData(), "tinkerbell-jobs.json");
  }

  async function handleExportClipboard() {
    await navigator.clipboard.writeText(JSON.stringify(getExportData(), null, 2));
    addToast("Copied jobs to clipboard", "success");
  }

  async function importJobs(text: string) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Expected an array of jobs");
    let count = 0;
    for (const item of data) {
      const existing = jobs.find((j) => j.id === item.id);
      if (!existing) continue;
      await updateMutation.mutateAsync({
        jobId: item.id,
        schedule: item.schedule,
        enabled: item.enabled,
        config: item.config,
      });
      count++;
    }
    utils.jobs.list.invalidate();
    addToast(`Updated ${count} job${count !== 1 ? "s" : ""}`, "success");
  }

  async function handleImportFile(file: File) {
    try {
      await importJobs(await file.text());
    } catch (err) {
      addToast(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImportClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      await importJobs(text);
    } catch (err) {
      addToast(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    }
  }

  // ─── Selection ──────────────────────────────────────────────────────────
  function handleCheckboxClick(index: number, e: React.MouseEvent) {
    const id = jobs[index].id;
    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(jobs[i].id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastClickedIndex.current = index;
  }

  function toggleSelectAll() {
    if (selected.size === jobs.length) setSelected(new Set());
    else setSelected(new Set(jobs.map((j) => j.id)));
  }

  async function bulkSetEnabled(enabled: boolean) {
    const ids = [...selected];
    setBulkProgress({ done: 0, total: ids.length });
    let done = 0;
    await pMap(
      ids,
      async (jobId) => {
        await updateMutation.mutateAsync({ jobId, enabled });
        done++;
        setBulkProgress({ done, total: ids.length });
      },
      { concurrency: 5 },
    );
    setBulkProgress(null);
    setSelected(new Set());
    utils.jobs.list.invalidate();
  }

  const handleRefresh = () => {
    jobsQuery.refetch();
    recentRunsQuery.refetch();
  };

  if (jobsQuery.isLoading) return <JobsSkeleton />;
  if (jobsQuery.error) return <p>Error: {jobsQuery.error.message}</p>;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className={styles.dashboard}>
        {/* ─── Summary Bar ──────────────────────────────────────────── */}
        <div className={styles.summaryBar}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Total</span>
            <span className={styles.summaryValue}>{rawJobs.length}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Enabled</span>
            <span className={styles.summaryValue}>{enabledCount}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Running</span>
            <span className={`${styles.summaryValue} ${runningCount > 0 ? styles.summaryAccent : ""}`}>
              {runningCount}
            </span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Last Failure</span>
            <span className={`${styles.summaryValue} ${styles.summarySmall}`}>
              {lastFailure?.lastRunStartedAt ? <RelativeTime timestamp={lastFailure.lastRunStartedAt} /> : "—"}
            </span>
          </div>
        </div>

        {/* ─── Two-column grid ──────────────────────────────────────── */}
        <div className={styles.grid}>
          {/* ─── Recent Runs ────────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>Recent Runs</div>
            {recentRunsQuery.data && recentRunsQuery.data.length > 0 ? (
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
                  {rollupRecentRuns(recentRunsQuery.data).map((group) => {
                    const run = group.latest;
                    return (
                      <tr key={run.id} className={styles.clickableRow} onClick={() => navigate(`/jobs/runs/${run.id}`)}>
                        <td>
                          {run.status === "running" ? (
                            <span className={styles.spinnerSmall} />
                          ) : (
                            <span className={styles.statusDot} data-status={run.status} />
                          )}
                        </td>
                        <td className={styles.nameCell}>
                          <span className={styles.jobNameText}>{run.jobName}</span>
                          {group.count > 1 && <span className={styles.rollupBadge}>×{group.count}</span>}
                          {run.status === "running" && run.progress > 0 && (
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
            ) : (
              <div className={styles.muted}>No recent runs</div>
            )}
          </div>

          {/* ─── Schedule Timeline ──────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>Upcoming</div>
            {upcoming.length > 0 ? (
              <table className={styles.compactTable}>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Next Run</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((item) => (
                    <tr
                      key={item.jobId}
                      className={styles.clickableRow}
                      onClick={() => navigate(`/jobs/${item.jobId}`)}
                    >
                      <td className={styles.nameCell}>
                        <span className={styles.jobNameText}>{item.name}</span>
                      </td>
                      <td className={styles.monoCell}>in {formatTimeUntil(item.nextRun)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={styles.muted}>No scheduled jobs</div>
            )}
          </div>

          {/* ─── All Jobs ─────────────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeaderRow}>
              <div className={styles.panelHeader}>
                All Jobs
                {jobs.length > 0 && <span className={styles.countBadge}>{jobs.length}</span>}
              </div>
              <div className={styles.headerActions}>
                <DropdownButton
                  label="Export"
                  className={styles.headerBtn}
                  disabled={jobs.length === 0}
                  options={[
                    { label: "File", onClick: handleExportFile },
                    { label: "Clipboard", onClick: handleExportClipboard },
                  ]}
                />
                <DropdownButton
                  label="Import"
                  className={styles.headerBtn}
                  options={[
                    { label: "File", onClick: () => fileInputRef.current?.click() },
                    { label: "Clipboard", onClick: handleImportClipboard },
                  ]}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
                />
              </div>
            </div>

            {selected.size > 0 && (
              <div className={shared.bulkBar}>
                {bulkProgress ? (
                  <>
                    <span style={{ fontSize: "0.8rem" }}>
                      {bulkProgress.done}/{bulkProgress.total}
                    </span>
                    <div className={shared.bulkProgressBar}>
                      <div
                        className={shared.bulkProgressFill}
                        style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{selected.size} selected</span>
                    <button className={`${styles.button} ${styles.buttonSmall}`} onClick={() => bulkSetEnabled(true)}>
                      Enable
                    </button>
                    <button className={`${styles.button} ${styles.buttonSmall}`} onClick={() => bulkSetEnabled(false)}>
                      Disable
                    </button>
                    <button
                      className={`${shared.buttonSecondary} ${styles.buttonSmall}`}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            )}

            <table className={styles.compactTable}>
              <thead>
                <tr>
                  <th className={shared.checkboxCell}>
                    <input
                      type="checkbox"
                      className={shared.checkbox}
                      checked={jobs.length > 0 && selected.size === jobs.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className={styles.sortable} onClick={() => toggleSort("name")}>
                    Name{sortIndicator("name")}
                  </th>
                  <th className={`${styles.sortable} ${styles.hideOnMobile}`} onClick={() => toggleSort("schedule")}>
                    Schedule{sortIndicator("schedule")}
                  </th>
                  <th className={styles.sortable} onClick={() => toggleSort("enabled")}>
                    On{sortIndicator("enabled")}
                  </th>
                  <th className={styles.sortable} onClick={() => toggleSort("lastRun")}>
                    Last Run{sortIndicator("lastRun")}
                  </th>
                  <th
                    className={`${styles.sortable} ${styles.hideOnMobile}`}
                    onClick={() => toggleSort("lastRunStatus")}
                  >
                    Status{sortIndicator("lastRunStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, i) => (
                  <tr
                    key={job.id}
                    className={`${styles.clickableRow} ${selected.has(job.id) ? shared.selectedRow : ""}`}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <td
                      className={shared.checkboxCell}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCheckboxClick(i, e);
                      }}
                    >
                      <input type="checkbox" className={shared.checkbox} checked={selected.has(job.id)} readOnly />
                    </td>
                    <td className={styles.nameCell}>
                      <span className={styles.jobNameText}>{job.name}</span>
                      <span className={styles.scheduleHintInline}>
                        {job.schedule ? describeCron(job.schedule) : "Manual"}
                      </span>
                    </td>
                    <td className={`${styles.scheduleCell} ${styles.hideOnMobile}`}>
                      <span className={styles.cronText} title={job.schedule || undefined}>
                        {job.schedule ? describeCron(job.schedule) : "—"}
                      </span>
                    </td>
                    <td
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <ToggleSwitch
                        size="sm"
                        checked={!!job.enabled}
                        onChange={(checked) => updateMutation.mutate({ jobId: job.id, enabled: checked })}
                      />
                    </td>
                    <td className={styles.monoCell}>
                      {job.lastRunStartedAt ? (
                        <RelativeTime timestamp={job.lastRunStartedAt} />
                      ) : (
                        <span className={styles.muted}>Never</span>
                      )}
                    </td>
                    <td className={`${styles.statusCell} ${styles.hideOnMobile}`}>
                      {job.lastRunStatus && (
                        <span className={styles.statusRow}>
                          <span className={styles.statusDot} data-status={job.lastRunStatus} />
                          {job.lastRunStatus}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ─── Recent Logs ──────────────────────────────────────────── */}
          {latestRunPerJob.length > 0 && (
            <div className={styles.panel}>
              <div className={styles.logTabsHeader}>
                <div className={styles.panelHeader}>Recent Logs</div>
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
              </div>
              {selectedRunQuery.data ? (
                <div className={styles.logWrapper}>
                  <button
                    className={styles.logCopyBtn}
                    onClick={() => navigator.clipboard.writeText(selectedRunQuery.data?.log ?? "")}
                  >
                    Copy
                  </button>
                  <pre ref={logRef} className={styles.logViewer}>
                    {selectedRunQuery.data.log || "(no output)"}
                  </pre>
                </div>
              ) : selectedRunQuery.isLoading ? (
                <div className={styles.muted}>Loading log…</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </PullToRefresh>
  );
}
