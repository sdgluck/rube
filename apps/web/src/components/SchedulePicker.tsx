import { useEffect, useState } from "react";
import {
  formatClock,
  formatSchedule,
  INTERVAL_STEPS,
  parseClock,
  parseSchedule,
  type IntervalUnit,
  type JobSchedule,
} from "@tinkerbell/contracts";
import controls from "#/styles/controls.module.css";
import styles from "./SchedulePicker.module.css";

export type ScheduleKind = JobSchedule["kind"];

const ALL_KINDS: Array<{ kind: ScheduleKind; label: string }> = [
  { kind: "daily", label: "Daily" },
  { kind: "weekly", label: "Weekly" },
  { kind: "interval", label: "Repeating" },
  { kind: "custom", label: "Cron" },
  { kind: "manual", label: "Manual" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The nearest schedule of another kind, keeping whatever time it had. */
function convert(current: JobSchedule, kind: ScheduleKind, cron: string): JobSchedule {
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

/**
 * A cron string edited as Daily / Weekly / Repeating, with raw cron as the
 * escape hatch.
 *
 * Shared by the job schedule editor and the rule wizard so "run at 3am" is
 * one control everywhere; the rule wizard used to take a bare cron box with a
 * paragraph explaining cron. Value in, value out is always the cron string —
 * `parseSchedule` keeps an unrecognised expression verbatim, so opening and
 * saving never rewrites what someone typed.
 */
export default function SchedulePicker({
  value,
  onChange,
  kinds,
  allowSeconds = false,
}: {
  value: string;
  onChange: (cron: string) => void;
  /** Which kinds to offer; defaults to all of them, Manual included. */
  kinds?: readonly ScheduleKind[];
  allowSeconds?: boolean;
}) {
  const schedule = parseSchedule(value);
  // The cron box edits locally and commits on blur, so a half-typed expression
  // isn't an undo step (or a red error) per keystroke.
  const [cronText, setCronText] = useState(value);
  useEffect(() => setCronText(value), [value]);

  const set = (next: JobSchedule) => onChange(formatSchedule(next));
  const units = (Object.keys(INTERVAL_STEPS) as IntervalUnit[]).filter((u) => u !== "second" || allowSeconds);
  const offered = kinds ? ALL_KINDS.filter((k) => kinds.includes(k.kind)) : ALL_KINDS;

  return (
    <>
      <div className={controls.segmented} role="radiogroup" aria-label="How often">
        {offered.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={schedule.kind === kind}
            className={`${controls.segmentedItem} ${schedule.kind === kind ? controls.segmentedItemActive : ""}`}
            onClick={() => schedule.kind !== kind && set(convert(schedule, kind, value))}
          >
            {label}
          </button>
        ))}
      </div>

      {(schedule.kind === "daily" || schedule.kind === "weekly") && (
        <label className={styles.row}>
          <span className={styles.label}>At</span>
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
        <div className={styles.row}>
          <span className={styles.label}>Every</span>
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
              <span className={styles.label}>at minute</span>
              <input
                type="number"
                min={0}
                max={59}
                className={`${controls.inputSm} ${styles.minuteInput}`}
                value={schedule.offset ?? 0}
                onChange={(e) => set({ ...schedule, offset: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
              />
            </>
          )}
        </div>
      )}

      {schedule.kind === "custom" && (
        <div className={styles.row}>
          <input
            className={`${controls.inputSm} ${controls.inputMono}`}
            value={cronText}
            aria-label="Cron expression"
            onChange={(e) => setCronText(e.target.value)}
            onBlur={() => cronText !== value && onChange(cronText.trim())}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
      )}
    </>
  );
}
