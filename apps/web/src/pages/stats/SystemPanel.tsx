import type React from "react";
import RelativeTime from "../../RelativeTime";
import Spinner from "../../Spinner";
import { trpc } from "../../trpc";
import { formatDurationMs, stripDurationFromMessage } from "../../utils";
import styles from "../Stats.module.css";
import { type PanelDragProps, PanelShell } from "./PanelShell";

export function SystemPanel({ dragHandle, dragProps }: { dragHandle: React.ReactNode; dragProps: PanelDragProps }) {
  const healthQuery = trpc.health.status.useQuery();
  const activeJobsQuery = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 10000 });
  const eventsQuery = trpc.events.list.useQuery({ limit: 5 });

  return (
    <PanelShell title="System Status" dragHandle={dragHandle} dragProps={dragProps}>
      {healthQuery.data && (
        <div className={styles.healthRow}>
          {healthQuery.data
            .filter((s) => s.configured)
            .map((svc) => (
              <span key={svc.service} className={styles.healthItem} title={svc.message ?? ""}>
                <span className={styles.healthDot} data-status={svc.status ?? "unknown"} />
                {svc.service}
              </span>
            ))}
        </div>
      )}
      <div className={styles.subSection}>
        <div className={styles.subHeader}>Jobs</div>
        <div className={styles.jobsBody}>
          {activeJobsQuery.data && activeJobsQuery.data.length > 0 ? (
            activeJobsQuery.data.map((run) => (
              <div key={run.id} className={styles.jobRow}>
                <Spinner size="xs" />
                <span className={styles.jobName}>{run.jobId}</span>
                {run.progress > 0 && <span className={styles.jobProgress}>{Math.round(run.progress * 100)}%</span>}
              </div>
            ))
          ) : (
            <div className={`${styles.muted} ${styles.jobsEmpty}`}>No active jobs</div>
          )}
        </div>
      </div>
      <div className={styles.subSection}>
        <div className={styles.subHeader}>Recent Events</div>
        {eventsQuery.data && eventsQuery.data.items.length > 0 ? (
          eventsQuery.data.items.map((event) => (
            <div key={event.id} className={styles.eventRow}>
              <span className={styles.eventTime}>
                <RelativeTime timestamp={event.timestamp} />
              </span>
              <span className={styles.eventMsg}>
                {event.count > 1 ? <strong>{event.count}× </strong> : null}
                {event.count > 1 && event.avgDurationMs != null
                  ? stripDurationFromMessage(event.message)
                  : event.message}
                {event.count > 1 && event.avgDurationMs != null && (
                  <span className={styles.muted}> (avg {formatDurationMs(event.avgDurationMs)})</span>
                )}
              </span>
            </div>
          ))
        ) : (
          <div className={styles.muted}>No recent events</div>
        )}
      </div>
    </PanelShell>
  );
}
