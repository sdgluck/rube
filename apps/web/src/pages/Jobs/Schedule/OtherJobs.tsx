import { Link } from "react-router-dom";
import {
  describeSchedule,
  formatSchedule,
  INTERVAL_STEPS,
  jobScheduleMeta,
  parseSchedule,
  type IntervalUnit,
  type JobPlanEntry,
  type JobSchedule,
  type ScheduleJob,
  type ScheduleSeverity,
} from "@tinkerbell/contracts";
import controls from "#/styles/controls.module.css";
import { MANUAL_JOB_MIME } from "./Timeline";
import styles from "./Schedule.module.css";

const DOT: Record<ScheduleSeverity, string> = {
  error: styles.dotError,
  warning: styles.dotWarning,
  info: styles.dotInfo,
};

/** Every interval a job may use, as one list: "Every 15 minutes", "Every 6 hours"… */
function intervalOptions(allowSeconds: boolean): Array<{ value: string; label: string }> {
  return (Object.keys(INTERVAL_STEPS) as IntervalUnit[])
    .filter((u) => u !== "second" || allowSeconds)
    .flatMap((unit) =>
      INTERVAL_STEPS[unit].map((every) => {
        const s: JobSchedule =
          unit === "hour" ? { kind: "interval", every, unit, offset: 0 } : { kind: "interval", every, unit };
        return { value: formatSchedule(s), label: describeSchedule(s) };
      }),
    );
}

/**
 * The jobs that aren't blocks on the timeline: those that repeat through the
 * day, and those that only run when started. Polls are edited by frequency —
 * the one thing about them worth choosing — and a manual job can be dragged
 * onto the timeline to give it a daily time.
 */
export default function OtherJobs({
  jobs,
  plan,
  selected,
  severityByJob,
  onSelect,
  onChange,
  kind,
}: {
  jobs: ScheduleJob[];
  plan: Record<string, JobPlanEntry>;
  selected: string | null;
  severityByJob: Map<string, ScheduleSeverity>;
  onSelect: (jobId: string) => void;
  onChange: (jobId: string, patch: Partial<JobPlanEntry>) => void;
  kind: "recurring" | "manual";
}) {
  if (jobs.length === 0) {
    return (
      <p className={styles.muted}>
        {kind === "recurring" ? "Nothing repeats through the day." : "Every job has a schedule."}
      </p>
    );
  }
  return (
    <ul className={styles.otherList}>
      {jobs.map((job) => {
        const entry = plan[job.id];
        const schedule = parseSchedule(entry.schedule);
        const severity = severityByJob.get(job.id);
        const options = intervalOptions(!!jobScheduleMeta(job.id).allowSeconds);
        const listed = options.some((o) => o.value === entry.schedule);
        return (
          <li
            key={job.id}
            className={selected === job.id ? styles.otherRowSelected : styles.otherRow}
            draggable={kind === "manual"}
            onDragStart={(e) => {
              e.dataTransfer.setData(MANUAL_JOB_MIME, job.id);
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            <button type="button" className={styles.otherName} onClick={() => onSelect(job.id)}>
              {severity && <span className={DOT[severity]} aria-label={severity} />}
              {job.name}
              {!entry.enabled && <span className={styles.offTag}>off</span>}
            </button>
            {kind === "recurring" &&
              schedule.kind === "interval" &&
              (jobScheduleMeta(job.id).pinned ? (
                <span className={styles.muted}>{describeSchedule(schedule)}</span>
              ) : (
                <select
                  className={`${controls.select} ${controls.selectSm}`}
                  value={entry.schedule}
                  aria-label={`How often ${job.name} runs`}
                  onChange={(e) => onChange(job.id, { schedule: e.target.value })}
                >
                  {!listed && <option value={entry.schedule}>{describeSchedule(schedule)}</option>}
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ))}
            {kind === "recurring" && schedule.kind === "custom" && (
              <code className={styles.cronTag}>{entry.schedule}</code>
            )}
            {kind === "manual" && (
              <span className={styles.otherActions}>
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                  onClick={() => {
                    onChange(job.id, { schedule: formatSchedule({ kind: "daily", time: 120 }) });
                    onSelect(job.id);
                  }}
                >
                  Schedule daily
                </button>
                <Link to={`/jobs/${job.id}`} className={styles.editorLink}>
                  Open
                </Link>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
