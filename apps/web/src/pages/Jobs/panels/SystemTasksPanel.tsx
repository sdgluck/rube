import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PanelCountBadge, PanelShell, type DashboardPanelProps } from "#components/dashboard";
import RelativeTime from "#components/RelativeTime";
import SortableTh from "#components/SortableTh";
import ToggleSwitch from "#components/ToggleSwitch";
import { EMPTY } from "#/format";
import { isAlwaysOnJob, SYSTEM_GROUPS, systemGroupOf, type SystemGroup } from "@tinkerbell/contracts";
import { useSetEnabled } from "#pages/Jobs/shared/useSetEnabled";
import { describeCron } from "#/utils";
import styles from "#pages/Jobs/Jobs.module.css";
import { useJobsData } from "#pages/Jobs/useJobsData";
import { isRunActive } from "#pages/Jobs/shared/useRunLog";

/*
 * System Tasks, in sections. Twenty-four tasks in one alphabetical list made a
 * failed backup one row among many and put the every-30-seconds pollers on the
 * same footing as the nightly jobs. Each section now collapses to a line that
 * says whether anything in it needs you — a failure opens its section on its
 * own — and the groups themselves are declared beside each job's description
 * in contracts' JOB_PRESENTATION, so a new system job can't go unfiled.
 */

type Job = ReturnType<typeof useJobsData>["systemJobs"][number];

interface Summary {
  failed: number;
  running: number;
  off: number;
  lastRunAt: number | null;
}

function summarise(jobs: Job[]): Summary {
  return {
    failed: jobs.filter((j) => j.lastRunStatus === "failed").length,
    running: jobs.filter((j) => isRunActive(j.lastRunStatus ?? undefined)).length,
    off: jobs.filter((j) => !j.enabled).length,
    lastRunAt: Math.max(0, ...jobs.map((j) => j.lastRunStartedAt ?? 0)) || null,
  };
}

export function SystemTasksPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { setEnabled } = useSetEnabled();
  const { systemJobs, statusFilter, sortKey, sortDir, toggleSort } = useJobsData();
  /* Only what the viewer has toggled; everything else follows the default. */
  const [expanded, setExpanded] = useState<Partial<Record<SystemGroup, boolean>>>({});

  // Sorting stays the table's — it orders the rows within each section.
  const groups = useMemo(
    () =>
      SYSTEM_GROUPS.map((g) => {
        const jobs = systemJobs.filter((j) => systemGroupOf(j.id) === g.id);
        return { ...g, jobs, summary: summarise(jobs) };
      }).filter((g) => g.jobs.length > 0),
    [systemJobs],
  );

  if (systemJobs.length === 0) return null;

  return (
    <PanelShell
      title="System Tasks"
      badge={<PanelCountBadge>{systemJobs.length}</PanelCountBadge>}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      <div className="table-scroll in-panel" data-scroll="x">
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
          {groups.map(({ id, label, jobs, summary }) => {
            const open = expanded[id] ?? (statusFilter !== null || summary.failed > 0);
            return (
              <tbody key={id}>
                <tr className={styles.groupRow}>
                  <th colSpan={5} scope="rowgroup">
                    <button
                      type="button"
                      className={styles.groupToggle}
                      aria-expanded={open}
                      onClick={() => setExpanded((prev) => ({ ...prev, [id]: !open }))}
                    >
                      {open ? <ChevronDown size="1.4rem" aria-hidden /> : <ChevronRight size="1.4rem" aria-hidden />}
                      <span className={styles.groupLabel}>{label}</span>
                      <GroupSummary count={jobs.length} summary={summary} />
                    </button>
                  </th>
                </tr>
                {open && jobs.map((job) => <TaskRow key={job.id} job={job} setEnabled={setEnabled} />)}
              </tbody>
            );
          })}
        </table>
      </div>
    </PanelShell>
  );
}

function GroupSummary({ count, summary }: { count: number; summary: Summary }) {
  return (
    <span className={styles.groupSummary}>
      <span>
        {count} task{count === 1 ? "" : "s"}
      </span>
      {summary.failed > 0 ? (
        <span className={styles.groupFailed}>
          <span className={styles.statusDot} data-status="failed" />
          {summary.failed} failed
        </span>
      ) : (
        <span>all ok</span>
      )}
      {summary.running > 0 && <span>{summary.running} running</span>}
      {summary.off > 0 && <span>{summary.off} off</span>}
      {summary.lastRunAt ? (
        <span className={styles.hideOnMobile}>
          last ran <RelativeTime timestamp={summary.lastRunAt} />
        </span>
      ) : null}
    </span>
  );
}

function TaskRow({ job, setEnabled }: { job: Job; setEnabled: ReturnType<typeof useSetEnabled>["setEnabled"] }) {
  const navigate = useNavigate();
  const isHealth = job.id === "healthcheck";
  return (
    <tr className={styles.clickableRow} onClick={() => navigate(isHealth ? "/settings/health" : `/jobs/${job.id}`)}>
      <td className={styles.nameCell}>
        <span className={styles.jobNameText}>{job.name}</span>
        <span className={styles.scheduleHintInline}>{job.schedule ? describeCron(job.schedule) : "Manual"}</span>
      </td>
      <td className={`${styles.scheduleCell} ${styles.hideOnMobile}`}>
        <span className={styles.cronText} title={job.schedule || undefined}>
          {job.schedule ? describeCron(job.schedule) : EMPTY}
        </span>
      </td>
      <td>
        {/* A switch only for jobs that really can be switched off. The ones the
            server keeps on get a quiet lock rather than the "REQUIRED" pill,
            which was on thirteen rows and the loudest thing in the table while
            saying the least. */}
        {!isAlwaysOnJob(job.id) ? (
          // The row navigates on click; the switch must not.
          <span onClick={(e) => e.stopPropagation()} role="presentation">
            <ToggleSwitch size="sm" checked={!!job.enabled} onChange={(next) => setEnabled(job.id, next)} />
          </span>
        ) : job.enabled ? (
          <span className={styles.alwaysOn} title="Always on — other parts of Tinkerbell depend on it">
            <Lock size="1.3rem" aria-label="Always on" />
          </span>
        ) : (
          <span className={styles.requiredPill} data-state="off" title="Switched off — this job is not running">
            Off
          </span>
        )}
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
}
