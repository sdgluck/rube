import { useRef, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import pMap from "p-map";
import { PanelCountBadge, PanelShell, type DashboardPanelProps } from "#components/dashboard";
import BulkBar from "#components/BulkBar";
import DropdownButton from "#components/DropdownButton";
import RelativeTime from "#components/RelativeTime";
import RowActions from "#components/RowActions";
import SortableTh from "#components/SortableTh";
import ToggleSwitch from "#components/ToggleSwitch";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import { EMPTY } from "#/format";
import { describeCron } from "#/utils";
import styles from "#pages/Jobs/Jobs.module.css";
import shared from "#/styles/shared.module.css";
import FeatureWizard from "#pages/Jobs/FeatureWizard";
import { getFeatureCatalogEntry } from "#pages/Jobs/FeatureWizard/feature-catalog";
import { isRunActive } from "#pages/Jobs/shared/useRunLog";
import { useJobsData } from "#pages/Jobs/useJobsData";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function FeaturesPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const { featureJobs, statusFilter, sortKey, sortDir, toggleSort } = useJobsData();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

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

  const startMutation = trpc.jobs.start.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      utils.jobs.recentRuns.invalidate();
      addToast("Started", "success");
    },
    onError: (err) => addToast(err.message, "error"),
  });

  // ─── Export / import ────────────────────────────────────────────────────
  function getExportData() {
    return featureJobs.map((j) => ({
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      enabled: !!j.enabled,
      config: j.config ?? {},
    }));
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
      await importJobs(await navigator.clipboard.readText());
    } catch (err) {
      addToast(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    }
  }

  // ─── Selection ──────────────────────────────────────────────────────────
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

  return (
    <PanelShell
      title="Your Features"
      badge={featureJobs.length > 0 ? <PanelCountBadge>{featureJobs.length}</PanelCountBadge> : null}
      lede="Optional capabilities you've installed. Toggle off to pause; remove anytime from each feature's page."
      actions={
        <>
          <button type="button" className={styles.headerBtn} onClick={() => setWizardOpen(true)}>
            + Add Feature
          </button>
          <DropdownButton
            label="Export"
            className={styles.headerBtn}
            disabled={featureJobs.length === 0}
            options={[
              { label: "File", onClick: () => downloadJson(getExportData(), "tinkerbell-features.json") },
              {
                label: "Clipboard",
                onClick: async () => {
                  await navigator.clipboard.writeText(JSON.stringify(getExportData(), null, 2));
                  addToast("Copied features to clipboard", "success");
                },
              },
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
        </>
      }
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {featureJobs.length === 0 ? (
        <p className={styles.muted} style={{ padding: "16px 0" }}>
          {/* An empty table under a filter is not an empty installation, and
              telling someone to add their first feature when they have twelve
              is the kind of wrong that makes people distrust the page. */}
          {statusFilter ? (
            <>No features match this filter.</>
          ) : (
            <>
              No features installed yet. Click <strong>+ Add Feature</strong> to pick one.
            </>
          )}
        </p>
      ) : (
        <>
          {selected.size > 0 && (
            <BulkBar
              count={selected.size}
              noun="feature"
              progress={bulkProgress ? { ...bulkProgress, label: "Updating" } : null}
              onClear={() => setSelected(new Set())}
              actions={[
                { label: "Enable", onClick: () => bulkSetEnabled(true) },
                { label: "Disable", onClick: () => bulkSetEnabled(false) },
              ]}
            />
          )}

          <div className="table-scroll in-panel" data-scroll="x">
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
                  <th aria-label="Actions" />
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
                    <td onClick={(e) => e.stopPropagation()}>
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
                    <td>
                      <RowActions
                        label={`Actions for ${job.name}`}
                        actions={[
                          {
                            label: "Run now",
                            icon: Play,
                            inline: true,
                            primary: true,
                            disabled: isRunActive(job.lastRunStatus ?? undefined) || startMutation.isPending,
                            onSelect: () => startMutation.mutate({ jobId: job.id }),
                          },
                          {
                            label: "Open",
                            icon: ExternalLink,
                            onSelect: () => navigate(`/jobs/${job.id}`),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {wizardOpen && <FeatureWizard onClose={() => setWizardOpen(false)} />}
    </PanelShell>
  );
}
