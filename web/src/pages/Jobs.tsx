import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import DropdownButton from "../DropdownButton";
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

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export default function Jobs() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const updateMutation = trpc.jobs.update.useMutation({ onSuccess: () => utils.jobs.list.invalidate() });

  const [importStatus, setImportStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasRunning = jobsQuery.data?.some((j) => j.lastRunStatus === "running");

  useEffect(() => {
    if (hasRunning) {
      const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
      return () => clearInterval(interval);
    }
  }, [hasRunning, utils]);

  const jobs = jobsQuery.data ?? [];

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
    setImportStatus({ type: "success", message: "Copied jobs to clipboard" });
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
    setImportStatus({ type: "success", message: `Updated ${count} job${count !== 1 ? "s" : ""}` });
  }

  async function handleImportFile(file: File) {
    try {
      await importJobs(await file.text());
    } catch (err) {
      setImportStatus({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImportClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      await importJobs(text);
    } catch (err) {
      setImportStatus({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  }

  if (jobsQuery.isLoading) return <p>Loading...</p>;
  if (jobsQuery.error) return <p>Error: {jobsQuery.error.message}</p>;

  return (
    <div>
      <div className={styles.jobsHeader}>
        <h1 className={styles.heading}>Jobs{jobs.length > 0 && <span className="count-badge">{jobs.length}</span>}</h1>
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
      {importStatus && (
        <div className={`${shared.toast} ${importStatus.type === "success" ? shared.success : shared.error}`}>
          {importStatus.message}
          <button
            style={{
              marginLeft: 12,
              background: "none",
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
            onClick={() => setImportStatus(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Schedule</th>
            <th>Enabled</th>
            <th>Last Run</th>
            <th>Last Run Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className={styles.clickableRow} onClick={() => navigate(`/jobs/${job.id}`)}>
              <td>{job.name}</td>
              <td>
                <span className={styles.cronText}>{job.schedule || "—"}</span>
                {job.schedule && <div className={styles.cronHint}>{describeCron(job.schedule)}</div>}
              </td>
              <td>{job.enabled ? "Yes" : "No"}</td>
              <td>
                <span className={styles.runMeta}>
                  {job.lastRunStartedAt ? formatTime(job.lastRunStartedAt) : "Never"}
                </span>
              </td>
              <td>{job.lastRunStatus ? <StatusBadge status={job.lastRunStatus} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
