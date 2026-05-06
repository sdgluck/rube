import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import useSwipeBack from "#hooks/useSwipeBack";
import RelativeTime from "#components/RelativeTime";
import styles from "#pages/Jobs/Jobs.module.css";
import type { Job } from "#pages/Jobs/types";
import { getJobDescription } from "#pages/Jobs/descriptions";
import { getGroupForMember } from "#pages/Jobs/groups";
import { getJobFields } from "#pages/Jobs/fields";
import { useJobActions } from "./useJobActions";
import { formatDuration } from "./formatDuration";

interface Props {
  job: Job;
  actions: ReturnType<typeof useJobActions>;
  children: ReactNode;
}

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function JobPageShell({ job, actions, children }: Props) {
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const { isRunning, latestRun, start, starting, cancel, cancelling } = actions;
  const description = getJobDescription(job.id);
  const fields = getJobFields(job.id);

  const membership = getGroupForMember(job.id);
  const jobsList = trpc.jobs.list.useQuery(undefined, { enabled: !!membership });
  const primary = membership ? jobsList.data?.find((j) => j.id === membership.group.primary) : undefined;
  const primaryDisabled = !!membership && primary != null && !primary.enabled;
  const runDisabledByGroup = !!membership && membership.member.requiresPrimary && primaryDisabled;

  const status = job.lastRunStatus;
  const lastDuration =
    latestRun && latestRun.status !== "running" ? formatDuration(latestRun.startedAt, latestRun.finishedAt) : null;

  return (
    <div ref={swipeRef} className={styles.jobDetail}>
      <Link to="/jobs" className={styles.backLink}>
        &larr; Back to Jobs
      </Link>

      <div className={styles.jobDetailHeader}>
        <div className={styles.jobDetailHeading}>
          <h1 className={styles.heading}>{job.name}</h1>
          {status && (
            <span className={styles.statusPill} data-status={status}>
              <span className={styles.statusDot} data-status={status} />
              <span>{STATUS_LABELS[status] ?? status}</span>
              {job.lastRunStartedAt && (
                <span className={styles.statusPillMeta}>
                  · <RelativeTime timestamp={job.lastRunStartedAt} />
                </span>
              )}
              {lastDuration && <span className={styles.statusPillMeta}>· {lastDuration}</span>}
            </span>
          )}
          {fields.enabled === "required" && <span className={styles.alwaysOnPill}>Always on</span>}
        </div>
        <div className={styles.jobDetailActions}>
          {isRunning && latestRun && (
            <button
              className={`${styles.button} ${styles.buttonDanger}`}
              onClick={() => cancel(latestRun.id)}
              disabled={cancelling}
            >
              Cancel
            </button>
          )}
          <button
            className={styles.button}
            disabled={isRunning || starting || runDisabledByGroup}
            onClick={start}
            title={runDisabledByGroup ? `Enable ${membership?.group.primaryName} first` : undefined}
          >
            {isRunning ? "Running…" : "Run Now"}
          </button>
        </div>
      </div>

      {description && <p className={styles.jobDescription}>{description}</p>}

      {membership && (
        <div className={primaryDisabled ? styles.jobNoticeWarning : styles.jobNotice}>
          <strong>Linked to {membership.group.primaryName}.</strong> {membership.member.summary}{" "}
          {primaryDisabled && (
            <>
              {membership.member.requiresPrimary
                ? `${membership.group.primaryName} is currently disabled — running this job now would have no effect.`
                : `${membership.group.primaryName} is currently disabled.`}{" "}
            </>
          )}
          <Link to={`/jobs/${membership.group.primary}`} className={styles.jobNoticeLink}>
            Open {membership.group.primaryName} →
          </Link>
        </div>
      )}

      {children}
    </div>
  );
}
