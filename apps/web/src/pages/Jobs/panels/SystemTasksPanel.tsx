import { useNavigate } from "react-router-dom";
import { PanelCountBadge, PanelShell, type DashboardPanelProps } from "#components/dashboard";
import RelativeTime from "#components/RelativeTime";
import SortableTh from "#components/SortableTh";
import { EMPTY } from "#/format";
import { describeCron } from "#/utils";
import styles from "#pages/Jobs/Jobs.module.css";
import { useJobsData } from "#pages/Jobs/useJobsData";

export function SystemTasksPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const navigate = useNavigate();
  const { systemJobs, sortKey, sortDir, toggleSort } = useJobsData();

  if (systemJobs.length === 0) return null;

  return (
    <PanelShell
      title="System Tasks"
      badge={<PanelCountBadge>{systemJobs.length}</PanelCountBadge>}
      lede="Infrastructure that keeps Tinkerbell in sync with Plex. Always on; schedules are tweakable."
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
                    {/* Reflects the row, never asserts over it. This pill used
                        to be a bare "Required" regardless of `enabled`, so a
                        system job that had been switched off looked healthy
                        and silently never ran. The server now repairs those on
                        boot; this is what makes the state visible if one slips
                        through again. */}
                    {job.enabled ? (
                      <span className={styles.requiredPill}>Required</span>
                    ) : (
                      <span
                        className={styles.requiredPill}
                        data-state="off"
                        title="Switched off — this job is not running"
                      >
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
            })}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}
