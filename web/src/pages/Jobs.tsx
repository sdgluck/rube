import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import pMap from "p-map";
import { trpc } from "../trpc";
import { describeCron } from "../utils";
import RelativeTime from "../RelativeTime";
import DropdownButton from "../DropdownButton";
import { JobsSkeleton } from "../Skeleton";
import ToggleSwitch from "../ToggleSwitch";
import { useToast } from "../Toast";
import PullToRefresh from "../PullToRefresh";
import styles from "./Jobs.module.css";
import shared from "./Collections.module.css";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
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

type SortKey = "name" | "schedule" | "enabled" | "lastRun" | "lastRunStatus";
type SortDir = "asc" | "desc";

export default function Jobs() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
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

  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem("jobs-sort-key");
    return stored && ["name", "schedule", "enabled", "lastRun", "lastRunStatus"].includes(stored)
      ? (stored as SortKey)
      : "name";
  });
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

  function getExportData() {
    return jobs.map((j) => {
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(j.config || "{}");
      } catch {}
      return { id: j.id, name: j.name, schedule: j.schedule, enabled: !!j.enabled, config };
    });
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

  function handleCheckboxClick(index: number, e: React.MouseEvent) {
    const id = jobs[index].id;

    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          next.add(jobs[i].id);
        }
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
    if (selected.size === jobs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(jobs.map((j) => j.id)));
    }
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

  if (jobsQuery.isLoading) return <JobsSkeleton />;
  if (jobsQuery.error) return <p>Error: {jobsQuery.error.message}</p>;

  return (
    <PullToRefresh
      onRefresh={() => {
        jobsQuery.refetch();
      }}
    >
      <div>
        <div className={styles.jobsHeader}>
          <h1 className={styles.heading}>
            Jobs{jobs.length > 0 && <span className="count-badge">{jobs.length}</span>}
          </h1>
          <div className={shared.headerActions}>
            <DropdownButton
              label="Export"
              className={shared.buttonSecondary}
              disabled={jobs.length === 0}
              options={[
                { label: "File", onClick: handleExportFile },
                { label: "Clipboard", onClick: handleExportClipboard },
              ]}
            />
            <DropdownButton
              label="Import"
              className={shared.buttonSecondary}
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
                <span style={{ fontSize: "0.85rem" }}>
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
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{selected.size} selected</span>
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
          <table className={styles.table}>
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
                <th className={styles.sortable} onClick={() => toggleSort("schedule")}>
                  Schedule{sortIndicator("schedule")}
                </th>
                <th className={styles.sortable} onClick={() => toggleSort("enabled")}>
                  Enabled{sortIndicator("enabled")}
                </th>
                <th className={styles.sortable} onClick={() => toggleSort("lastRun")}>
                  Last Run{sortIndicator("lastRun")}
                </th>
                <th className={styles.sortable} onClick={() => toggleSort("lastRunStatus")}>
                  Last Run Status{sortIndicator("lastRunStatus")}
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
                  <td>{job.name}</td>
                  <td>
                    <span className={styles.cronText}>{job.schedule || "—"}</span>
                    {job.schedule && <div className={styles.cronHint}>{describeCron(job.schedule)}</div>}
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
                  <td>
                    <span className={styles.runMeta}>
                      {job.lastRunStartedAt ? <RelativeTime timestamp={job.lastRunStartedAt} /> : "Never"}
                    </span>
                  </td>
                  <td>{job.lastRunStatus ? <StatusBadge status={job.lastRunStatus} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PullToRefresh>
  );
}
