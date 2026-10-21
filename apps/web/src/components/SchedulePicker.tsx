import { useEffect, useRef, useState } from "react";
import {
  formatClock,
  formatSchedule,
  INTERVAL_STEPS,
  DEFAULT_BUILDER,
  formatBuilder,
  parseBuilder,
  parseClock,
  parseSchedule,
  type IntervalUnit,
  type JobSchedule,
} from "@rube/contracts";
import controls from "#/styles/controls.module.css";
import ScheduleBuilder from "./ScheduleBuilder";
import styles from "./SchedulePicker.module.css";

export type ScheduleKind = JobSchedule["kind"];

const ALL_KINDS: Array<{ kind: ScheduleKind; label: string }> = [
  { kind: "daily", label: "Daily" },
  { kind: "weekly", label: "Weekly" },
  { kind: "interval", label: "Repeating" },
  { kind: "custom", label: "Custom" },
  { kind: "manual", label: "Manual" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The nearest schedule of another kind, keeping whatever time it had. */
function convert(current: JobSchedule, kind: ScheduleKind, cron: string): JobSchedule {
  // From a custom schedule, keep its first set time if it has one: "the 1st
  // at 04:00" → Daily should be daily at 04:00, not at a default.
  const built = current.kind === "custom" ? parseBuilder(cron) : null;
  const time =
    current.kind === "daily" || current.kind === "weekly"
      ? current.time
      : built?.time.kind === "at"
        ? built.time.times[0]
        : 120;
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
 * A cron string edited as Daily / Weekly / Repeating, with Custom — the
 * plain-language builder, raw cron behind it — for everything else.
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
  const parsed = parseSchedule(value);
  // Custom is sticky. Built in the builder, "every day at 03:00" is also a
  // Daily schedule, and re-deriving the tab from the value would yank the
  // user out of the builder mid-edit. Only a change from outside (undo, the
  // timeline, another tab) re-derives it.
  const [custom, setCustom] = useState(parsed.kind === "custom");
  const emitted = useRef(value);
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setCustom(parseSchedule(value).kind === "custom");
  }, [value]);
  const emit = (cron: string) => {
    emitted.current = cron;
    onChange(cron);
  };
  const schedule: JobSchedule = custom ? { kind: "custom", cron: value } : parsed;

  const set = (next: JobSchedule) => {
    setCustom(false);
    emit(formatSchedule(next));
  };
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
            onClick={() => {
              if (schedule.kind === kind) return;
              if (kind === "custom") {
                setCustom(true);
                // From Manual there is nothing to build on; start from a real
                // schedule so what the builder shows is what would be saved.
                if (parsed.kind === "manual") emit(formatBuilder(DEFAULT_BUILDER));
              } else set(convert(parsed, kind, value));
            }}
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
            className={`${controls.input} ${controls.inputSm}`}
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
            className={`${controls.select} ${controls.selectSm}`}
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
            className={`${controls.select} ${controls.selectSm}`}
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
                className={`${`${controls.input} ${controls.inputSm}`} ${styles.minuteInput}`}
                value={schedule.offset ?? 0}
                onChange={(e) => set({ ...schedule, offset: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
              />
            </>
          )}
        </div>
      )}

      {schedule.kind === "custom" && <ScheduleBuilder value={value} onChange={emit} />}
    </>
  );
}
