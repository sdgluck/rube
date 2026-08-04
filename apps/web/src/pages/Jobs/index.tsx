import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Cron } from "croner";
import pMap from "p-map";
import { trpc } from "#/trpc";
import { describeCron } from "#/utils";
import RelativeTime from "#components/RelativeTime";
import DropdownButton from "#components/DropdownButton";
import { JobsSkeleton } from "#components/Skeleton";
import Spinner from "#components/Spinner";
import ToggleSwitch from "#components/ToggleSwitch";
import { useToast } from "#components/Toast";
import PullToRefresh from "#components/PullToRefresh";

import { EMPTY, formatDuration, formatTimeUntil } from "#/format";
import ErrorState from "#components/ErrorState";
import SortableTh from "#components/SortableTh";
import { useListParams } from "#hooks/useListParams";
import styles from "./Jobs.module.css";
import shared from "#/styles/shared.module.css";
import { getJobFields } from "./fields";
import FeatureWizard from "./FeatureWizard";
import { getFeatureCatalogEntry } from "./FeatureWizard/feature-catalog";
import { isRunActive, useRunLog } from "./shared/useRunLog";

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
    const finished = !isRunActive(run.status) && run.finishedAt != null;
    const dur = finished ? (run.finishedAt as number) - run.startedAt : 0;
    if (last && last.latest.jobId === run.jobId && last.latest.status === run.status && !isRunActive(run.status)) {
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

function formatGroupDuration(group: RecentRunGroup): string {
  if (isRunActive(group.latest.status)) return EMPTY;
  if (group.count === 1) return formatDuration(group.maxDurationMs);
  if (group.minDurationMs === group.maxDurationMs) return formatDuration(group.maxDurationMs);
  return `${formatDuration(group.minDurationMs)}–${formatDuration(group.maxDurationMs)}`;
}

const SORT_KEYS = ["name", "schedule", "enabled", "lastRun", "lastRunStatus"] as const;
type SortKey = (typeof SORT_KEYS)[number];

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
  const [wizardOpen, setWizardOpen] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const recentRunsQuery = trpc.jobs.recentRuns.useQuery(undefined, { refetchInterval: 3000 });
  const selectedRunQuery = trpc.jobs.run.useQuery(
    { runId: selectedRunId! },
    {
      enabled: !!selectedRunId,
      refetchInterval: (query) => (isRunActive(query.state.data?.status) ? 1000 : false),
    },
  );
  const selectedLog = useRunLog(selectedRunId, isRunActive(selectedRunQuery.data?.status));

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

  const installMutation = trpc.jobs.install.useMutation();

  const { sortKey, sortDir, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "name",
    descFirst: ["lastRun"],
  });

  const hasRunning = jobsQuery.data?.some((j) => isRunActive(j.lastRunStatus ?? undefined));

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

  const rawJobs = (jobsQuery.data ?? []).filter((j) => getJobFields(j.id).kind !== "hidden");
  const sortedJobs = [...rawJobs].sort((a, b) => {
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

  // System Tasks vs Features split — kind comes from fields.ts.
  const systemJobs = sortedJobs.filter((j) => getJobFields(j.id).kind === "system");
  const featureJobs = sortedJobs.filter((j) => getJobFields(j.id).kind === "feature");
  const jobs = sortedJobs;

  // ─── Derived stats ──────────────────────────────────────────────────────
  const enabledCount = rawJobs.filter((j) => j.enabled).length;
  const runningCount = recentRunsQuery.data?.filter((r) => isRunActive(r.status)).length ?? 0;
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

  // ─── Export/Import (Your Features only) ─────────────────────────────────
  function getExportData() {
    return featureJobs.map((j) => ({
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      enabled: !!j.enabled,
      config: j.config ?? {},
    }));
  }

  function handleExportFile() {
    downloadJson(getExportData(), "tinkerbell-features.json");
  }

  async function handleExportClipboard() {
    await navigator.clipboard.writeText(JSON.stringify(getExportData(), null, 2));
    addToast("Copied features to clipboard", "success");
  }

  async function importJobs(text: string) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Expected an array of features");

    const installedIds = new Set(featureJobs.map((j) => j.id));
    let installed = 0;
    let updated = 0;
    const unknown: string[] = [];

    for (const item of data) {
      if (!item || typeof item.id !== "string") continue;
      if (!getFeatureCatalogEntry(item.id)) {
        unknown.push(item.id);
        continue;
      }
      if (installedIds.has(item.id)) {
        await updateMutation.mutateAsync({
          jobId: item.id,
          schedule: item.schedule,
          enabled: item.enabled,
          config: item.config,
        });
        updated++;
      } else {
        await installMutation.mutateAsync({
          featureId: item.id,
          schedule: item.schedule,
          config: item.config,
        });
        // installFeature always sets enabled=1; respect explicit `enabled: false` from import.
        if (item.enabled === false) {
          await updateMutation.mutateAsync({ jobId: item.id, enabled: false });
        }
        installed++;
      }
    }

    utils.jobs.list.invalidate();

    const parts: string[] = [];
    if (installed) parts.push(`installed ${installed}`);
    if (updated) parts.push(`updated ${updated}`);
    if (unknown.length) parts.push(`skipped ${unknown.length} unknown (${unknown.join(", ")})`);
    addToast(parts.length ? `Import: ${parts.join(", ")}` : "Nothing to import", parts.length ? "success" : "info");
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

  // ─── Selection (features only — system tasks aren't selectable) ─────────
  function handleCheckboxClick(index: number, e: React.MouseEvent) {
    const id = featureJobs[index].id;
    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(featureJobs[i].id);
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
    if (featureJobs.length > 0 && featureJobs.every((j) => selected.has(j.id))) setSelected(new Set());
    else setSelected(new Set(featureJobs.map((j) => j.id)));
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
  if (jobsQuery.error) {
    return <ErrorState title="Couldn't load jobs" error={jobsQuery.error} onRetry={() => jobsQuery.refetch()} />;
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className={styles.dashboard}>
        <h2 className="sr-only">Jobs</h2>
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
              {lastFailure?.lastRunStartedAt ? <RelativeTime timestamp={lastFailure.lastRunStartedAt} /> : EMPTY}
            </span>
          </div>
        </div>

        {/* ─── Two-column grid ──────────────────────────────────────── */}
        <div className={styles.grid}>
          {/* ─── Recent Runs ────────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>Recent Runs</div>
            {recentRunsQuery.data && recentRunsQuery.data.length > 0 ? (
              <div className="table-scroll">
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
                        <tr
                          key={run.id}
                          className={styles.clickableRow}
                          onClick={() => navigate(`/jobs/runs/${run.id}`)}
                        >
                          <td>
                            {isRunActive(run.status) ? (
                              <Spinner size="xs" />
                            ) : (
                              <span className={styles.statusDot} data-status={run.status} />
                            )}
                          </td>
                          <td className={styles.nameCell}>
                            <span className={styles.jobNameText}>{run.jobName}</span>
                            {group.count > 1 && <span className={styles.rollupBadge}>×{group.count}</span>}
                            {isRunActive(run.status) && run.progress > 0 && (
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
              </div>
            ) : (
              <div className={styles.muted}>No recent runs</div>
            )}
          </div>

          {/* ─── Schedule Timeline ──────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>Upcoming</div>
            {upcoming.length > 0 ? (
              <div className="table-scroll">
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
              </div>
            ) : (
              <div className={styles.muted}>No scheduled jobs</div>
            )}
          </div>

          {/* ─── System Tasks ────────────────────────────────────────── */}
          {systemJobs.length > 0 && (
            <div className={styles.panel}>
              <div className={styles.panelHeaderRow}>
                <div className={styles.panelHeader}>
                  System Tasks
                  <span className={styles.countBadge}>{systemJobs.length}</span>
                </div>
              </div>
              <p className={styles.muted} style={{ marginTop: 0, marginBottom: 8 }}>
                Infrastructure that keeps Tinkerbell in sync with Plex. Always on; schedules are tweakable.
              </p>
              <div className="table-scroll">
                <table className={styles.compactTable}>
                  <thead>
                    <tr>
                      <SortableTh sortKey="name" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Name
                      </SortableTh>
                      <SortableTh
                        sortKey="schedule"
                        activeKey={sortKey}
                        activeDir={sortDir}
                        onSort={toggleSort}
                        className={styles.hideOnMobile}
                      >
                        Schedule
                      </SortableTh>
                      <th>On</th>
                      <SortableTh sortKey="lastRun" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Last Run
                      </SortableTh>
                      <SortableTh
                        sortKey="lastRunStatus"
                        activeKey={sortKey}
                        activeDir={sortDir}
                        onSort={toggleSort}
                        className={styles.hideOnMobile}
                      >
                        Status
                      </SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {systemJobs.map((job) => {
                      const isHealth = job.id === "healthcheck";
                      return (
                        <tr
                          key={job.id}
                          className={styles.clickableRow}
                          onClick={() => navigate(isHealth ? "/settings/health" : `/jobs/${job.id}`)}
                        >
                          <td className={styles.nameCell}>
                            <span className={styles.jobNameText}>{job.name}</span>
                            <span className={styles.scheduleHintInline}>
                              {job.schedule ? describeCron(job.schedule) : "Manual"}
                            </span>
                          </td>
                          <td className={`${styles.scheduleCell} ${styles.hideOnMobile}`}>
                            <span className={styles.cronText} title={job.schedule || undefined}>
                              {job.schedule ? describeCron(job.schedule) : EMPTY}
                            </span>
                          </td>
                          <td>
                            <span className={styles.requiredPill}>Required</span>
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Your Features ────────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeaderRow}>
              <div className={styles.panelHeader}>
                Your Features
                {featureJobs.length > 0 && <span className={styles.countBadge}>{featureJobs.length}</span>}
              </div>
              <div className={styles.headerActions}>
                <button type="button" className={styles.headerBtn} onClick={() => setWizardOpen(true)}>
                  + Add Feature
                </button>
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
            <p className={styles.muted} style={{ marginTop: 0, marginBottom: 8 }}>
              Optional capabilities you've installed. Toggle off to pause; remove anytime from each feature's page.
            </p>
            {featureJobs.length === 0 && (
              <p className={styles.muted} style={{ padding: "16px 0" }}>
                No features installed yet. Click <strong>+ Add Feature</strong> to pick one.
              </p>
            )}

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

            <div className="table-scroll">
              <table className={styles.compactTable}>
                <thead>
                  <tr>
                    <th className={shared.checkboxCell}>
                      <input
                        type="checkbox"
                        className={shared.checkbox}
                        checked={featureJobs.length > 0 && featureJobs.every((j) => selected.has(j.id))}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <SortableTh sortKey="name" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Name
                    </SortableTh>
                    <SortableTh
                      sortKey="schedule"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={toggleSort}
                      className={styles.hideOnMobile}
                    >
                      Schedule
                    </SortableTh>
                    <SortableTh sortKey="enabled" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      On
                    </SortableTh>
                    <SortableTh sortKey="lastRun" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Last Run
                    </SortableTh>
                    <SortableTh
                      sortKey="lastRunStatus"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onSort={toggleSort}
                      className={styles.hideOnMobile}
                    >
                      Status
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {featureJobs.map((job, i) => (
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
                          {job.schedule ? describeCron(job.schedule) : EMPTY}
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
            </div>
          )}
        </div>
      </div>
      {wizardOpen && <FeatureWizard onClose={() => setWizardOpen(false)} />}
    </PullToRefresh>
  );
}
