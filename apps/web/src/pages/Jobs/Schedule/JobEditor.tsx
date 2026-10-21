import { Link } from "react-router-dom";
import {
  canDisableJob,
  describeSchedule,
  isSchedulableJob,
  jobScheduleMeta,
  MINUTE_MS,
  parseSchedule,
  sameSchedule,
  SCHEDULE_SERVICE_LABELS,
  type JobPlanEntry,
  type ScheduleJob,
} from "@rube/contracts";
import CronPreview from "#components/CronPreview";
import SchedulePicker from "#components/SchedulePicker";
import controls from "#/styles/controls.module.css";
import styles from "./Schedule.module.css";

const LANE_LABEL = { default: "Batch queue", interactive: "Interactive queue", internal: "Runs alongside" };

function durationText(job: ScheduleJob): string {
  if (job.typicalMs === null) {
    return `Not run yet — estimated at ${Math.round(jobScheduleMeta(job.id).estimateMs / MINUTE_MS)} min.`;
  }
  const minutes = Math.max(1, Math.round(job.typicalMs / MINUTE_MS));
  return `Typically ${minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(1)}h`}, from its last ${job.samples} run${job.samples === 1 ? "" : "s"}.`;
}

export default function JobEditor({
  job,
  entry,
  saved,
  timezone,
  onChange,
}: {
  job: ScheduleJob;
  entry: JobPlanEntry;
  saved: JobPlanEntry;
  timezone: string;
  onChange: (patch: Partial<JobPlanEntry>) => void;
}) {
  const meta = jobScheduleMeta(job.id);
  const schedule = parseSchedule(entry.schedule);
  const readOnly = meta.pinned || !isSchedulableJob(job.id);

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <div>
          <div className={styles.editorTitle}>{job.name}</div>
          <div className={styles.editorMeta}>
            {LANE_LABEL[job.lane]}
            {meta.heavy ? " · heavy — held back by the window" : ""}
          </div>
        </div>
        <Link to={`/jobs/${job.id}`} className={styles.editorLink}>
          Job page
        </Link>
      </div>
      <p className={styles.editorHint}>{durationText(job)}</p>
      {meta.requires && (
        <p className={styles.editorHint}>
          Needs {SCHEDULE_SERVICE_LABELS[meta.requires]}
          {meta.noopWithoutService ? " — does nothing without it, and starts working once it's set up." : "."}
        </p>
      )}

      {readOnly ? (
        <p className={styles.editorHint}>
          <strong>{describeSchedule(schedule)}</strong>.{" "}
          {meta.pinned
            ? "This is the clock every rule's own schedule runs on, so it isn't movable."
            : "Started from elsewhere in the app, not on a schedule."}
        </p>
      ) : (
        <>
          <SchedulePicker
            value={entry.schedule}
            onChange={(cron) => onChange({ schedule: cron })}
            allowSeconds={meta.allowSeconds}
          />
          {schedule.kind !== "manual" && <CronPreview expr={entry.schedule} timezone={timezone} />}

          <div className={styles.editorFooter}>
            <label className={styles.enabledToggle}>
              <input
                type="checkbox"
                className={controls.toggleSm}
                checked={entry.enabled}
                disabled={!canDisableJob(job.id)}
                onChange={(e) => onChange({ enabled: e.target.checked })}
              />
              {canDisableJob(job.id) ? "Enabled" : "Always on"}
            </label>
            {job.defaultSchedule !== null && !sameSchedule(entry.schedule, job.defaultSchedule) && (
              <button
                type="button"
                className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                onClick={() => onChange({ schedule: job.defaultSchedule ?? "" })}
              >
                Shipped default ({describeSchedule(parseSchedule(job.defaultSchedule))})
              </button>
            )}
            {(!sameSchedule(entry.schedule, saved.schedule) || entry.enabled !== saved.enabled) && (
              <button
                type="button"
                className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                onClick={() => onChange(saved)}
              >
                Undo changes
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
