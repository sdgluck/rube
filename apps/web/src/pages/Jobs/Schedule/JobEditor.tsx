import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  canDisableJob,
  describeSchedule,
  formatClock,
  formatSchedule,
  INTERVAL_STEPS,
  isSchedulableJob,
  jobScheduleMeta,
  MINUTE_MS,
  parseClock,
  parseSchedule,
  sameSchedule,
  SCHEDULE_SERVICE_LABELS,
  type IntervalUnit,
  type JobPlanEntry,
  type JobSchedule,
  type ScheduleJob,
} from "@tinkerbell/contracts";
import CronPreview from "#components/CronPreview";
import controls from "#/styles/controls.module.css";
import styles from "./Schedule.module.css";

type Kind = JobSchedule["kind"];

const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: "daily", label: "Daily" },
  { kind: "weekly", label: "Weekly" },
  { kind: "interval", label: "Repeating" },
  { kind: "custom", label: "Cron" },
  { kind: "manual", label: "Manual" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LANE_LABEL = { default: "Batch queue", interactive: "Interactive queue", internal: "Runs alongside" };

/** The nearest schedule of another kind, keeping whatever time it had. */
function convert(current: JobSchedule, kind: Kind, cron: string): JobSchedule {
  const time = current.kind === "daily" || current.kind === "weekly" ? current.time : 120;
  switch (kind) {
    case "manual":
      return { kind: "manual" };
    case "daily":
      return { kind: "daily", time };
    case "weekly":
      return { kind: "weekly", days: current.kind === "weekly" ? current.days : [0], time };
    case "interval":
      return current.kind === "interval" ? current : { kind: "interval", every: 1, unit: "hour", offset: 0 };
    case "custom":
      return { kind: "custom", cron: cron || "0 2 * * *" };
  }
}

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
  // The cron box edits locally and commits on blur, so a half-typed expression
  // isn't an undo step (or a red error) per keystroke.
  const [cronText, setCronText] = useState(entry.schedule);
  useEffect(() => setCronText(entry.schedule), [entry.schedule]);

  const set = (next: JobSchedule) => onChange({ schedule: formatSchedule(next) });
  const readOnly = meta.pinned || !isSchedulableJob(job.id);
  const units = (Object.keys(INTERVAL_STEPS) as IntervalUnit[]).filter((u) => u !== "second" || meta.allowSeconds);

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
          <div className={controls.segmented} role="radiogroup" aria-label="How often">
            {KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={schedule.kind === kind}
                className={`${controls.segmentedItem} ${schedule.kind === kind ? controls.segmentedItemActive : ""}`}
                onClick={() => schedule.kind !== kind && set(convert(schedule, kind, entry.schedule))}
              >
                {label}
              </button>
            ))}
          </div>

          {(schedule.kind === "daily" || schedule.kind === "weekly") && (
            <label className={styles.editorField}>
              <span className={styles.editorLabel}>At</span>
              <input
                type="time"
                className={controls.inputSm}
                value={formatClock(schedule.time)}
                step={900}
                onChange={(e) => {
                  const time = parseClock(e.target.value);
                  if (time !== null) set({ ...schedule, time });
                }}
              />
            </label>
          )}

          {schedule.kind === "weekly" && (
            <div className={styles.dayPicker} role="group" aria-label="Days">
              {DAYS.map((label, day) => {
                const on = schedule.days.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    className={on ? styles.dayOn : styles.day}
                    onClick={() => {
                      const days = on
                        ? schedule.days.filter((d) => d !== day)
                        : [...schedule.days, day].sort((a, b) => a - b);
                      if (days.length === 0) return;
                      set(days.length === 7 ? { kind: "daily", time: schedule.time } : { ...schedule, days });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {schedule.kind === "interval" && (
            <div className={styles.editorField}>
              <span className={styles.editorLabel}>Every</span>
              <select
                className={controls.selectSm}
                value={schedule.every}
                aria-label="Interval"
                onChange={(e) => set({ ...schedule, every: Number(e.target.value) })}
              >
                {INTERVAL_STEPS[schedule.unit].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                className={controls.selectSm}
                value={schedule.unit}
                aria-label="Unit"
                onChange={(e) => {
                  const unit = e.target.value as IntervalUnit;
                  set({
                    kind: "interval",
                    unit,
                    every: INTERVAL_STEPS[unit][0],
                    ...(unit === "hour" ? { offset: 0 } : {}),
                  });
                }}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}s
                  </option>
                ))}
              </select>
              {schedule.unit === "hour" && (
                <>
                  <span className={styles.editorLabel}>at minute</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    className={`${controls.inputSm} ${styles.minuteInput}`}
                    value={schedule.offset ?? 0}
                    onChange={(e) =>
                      set({ ...schedule, offset: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })
                    }
                  />
                </>
              )}
            </div>
          )}

          {schedule.kind === "custom" && (
            <div className={styles.editorField}>
              <input
                className={`${controls.inputSm} ${controls.inputMono}`}
                value={cronText}
                aria-label="Cron expression"
                onChange={(e) => setCronText(e.target.value)}
                onBlur={() => cronText !== entry.schedule && onChange({ schedule: cronText.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </div>
          )}
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
