import { useEffect, useRef, useState } from "react";
import {
  ALL_MONTHS,
  builderError,
  DEFAULT_BUILDER,
  formatBuilder,
  formatClock,
  MONTH_NAMES,
  NTH_OPTIONS,
  parseBuilder,
  parseClock,
  REPEAT_HOUR_STEPS,
  REPEAT_MINUTE_STEPS,
  WEEKDAY_NAMES,
  type BuilderDays,
  type BuilderSchedule,
  type BuilderTime,
  type Nth,
} from "@tinkerbell/contracts";
import controls from "#/styles/controls.module.css";
import styles from "./SchedulePicker.module.css";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DATES = Array.from({ length: 31 }, (_, i) => i + 1);
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first, as a calendar reads

function toggle(values: number[], value: number): number[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value].sort((a, b) => a - b);
}

function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      className={on ? styles.dayOn : styles.day}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The Custom tab of `SchedulePicker`: anything cron can say that the builder
 * can show, as three plain questions — what time, which days, which months.
 *
 * Edits are held locally and only an expression that is valid *and* complete
 * is emitted, so a half-made choice ("Dates", none ticked yet) is an inline
 * hint rather than a schedule that never fires. Raw cron is still one click
 * away, and is where anything the builder can't represent opens; switching
 * back is offered only when the typed expression would survive the trip.
 */
export default function ScheduleBuilder({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const [draft, setDraft] = useState<BuilderSchedule>(() => parseBuilder(value) ?? DEFAULT_BUILDER);
  const [raw, setRaw] = useState(() => value.trim() !== "" && parseBuilder(value) === null);
  const [cronText, setCronText] = useState(value);
  // What we last emitted. A `value` that differs came from outside — undo, a
  // preset, the timeline — and replaces the draft; our own echo must not, or
  // re-parsing would snap the controls to a different-but-equal reading.
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const parsed = parseBuilder(value);
    if (parsed) setDraft(parsed);
    setRaw(value.trim() !== "" && parsed === null);
    setCronText(value);
  }, [value]);

  const error = builderError(draft);

  function update(next: BuilderSchedule) {
    setDraft(next);
    if (builderError(next)) return;
    const cron = formatBuilder(next);
    emitted.current = cron;
    setCronText(cron);
    onChange(cron);
  }
  const setTime = (time: BuilderTime) => update({ ...draft, time });
  const setDays = (days: BuilderDays) => update({ ...draft, days });

  if (raw) {
    const builderCan = parseBuilder(cronText) !== null;
    return (
      <div className={styles.builder}>
        <div className={styles.row}>
          <input
            className={`${`${controls.input} ${controls.inputSm}`} ${controls.inputMono}`}
            value={cronText}
            aria-label="Cron expression"
            onChange={(e) => setCronText(e.target.value)}
            onBlur={() => {
              const next = cronText.trim();
              if (next === value) return;
              emitted.current = next;
              onChange(next);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        {builderCan ? (
          <button
            type="button"
            className={`${controls.btn} ${controls.btnLink}`}
            onClick={() => {
              setDraft(parseBuilder(cronText)!);
              setRaw(false);
            }}
          >
            Edit with the schedule builder
          </button>
        ) : (
          cronText.trim() !== "" && (
            <span className={styles.hint}>This expression is too intricate for the builder.</span>
          )
        )}
      </div>
    );
  }

  const { time, days, months } = draft;

  return (
    <div className={styles.builder}>
      {/* ── Time ─────────────────────────────────────────────────────────── */}
      <div className={styles.row}>
        <span className={styles.builderLabel}>Time</span>
        <select
          className={`${controls.select} ${controls.selectSm}`}
          aria-label="Time"
          value={time.kind}
          onChange={(e) =>
            setTime(
              e.target.value === "at"
                ? { kind: "at", times: [120] }
                : { kind: "repeat", every: 1, unit: "hour", from: 0, to: 23, minute: 0 },
            )
          }
        >
          <option value="at">At set times</option>
          <option value="repeat">Repeatedly</option>
        </select>
      </div>

      {time.kind === "at" && (
        <div className={styles.row}>
          {time.times.map((t, i) => (
            <span key={i} className={styles.timeItem}>
              <input
                type="time"
                className={`${controls.input} ${controls.inputSm}`}
                value={formatClock(t)}
                aria-label={`Time ${i + 1}`}
                onChange={(e) => {
                  const next = parseClock(e.target.value);
                  if (next === null) return;
                  const times = [...time.times];
                  times[i] = next;
                  setTime({ kind: "at", times: [...new Set(times)].sort((a, b) => a - b) });
                }}
              />
              {time.times.length > 1 && (
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnIcon} ${controls.btnGhost}`}
                  aria-label={`Remove ${formatClock(t)}`}
                  onClick={() => setTime({ kind: "at", times: time.times.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSm} ${controls.btnGhost}`}
            onClick={() => {
              // A new time in the next free hour at the same minute — the one
              // shape that is always expressible alongside the existing ones.
              const last = time.times[time.times.length - 1] ?? 0;
              const minute = last % 60;
              const taken = new Set(time.times.map((t) => Math.floor(t / 60)));
              const hour =
                HOURS.find((h) => h > Math.floor(last / 60) && !taken.has(h)) ?? HOURS.find((h) => !taken.has(h));
              if (hour === undefined) return;
              setTime({ kind: "at", times: [...time.times, hour * 60 + minute].sort((a, b) => a - b) });
            }}
          >
            Add time
          </button>
        </div>
      )}

      {time.kind === "repeat" && (
        <div className={styles.row}>
          <span className={styles.label}>Every</span>
          <select
            className={`${controls.select} ${controls.selectSm}`}
            aria-label="Repeat every"
            value={time.every}
            onChange={(e) => setTime({ ...time, every: Number(e.target.value) })}
          >
            {(time.unit === "minute" ? [1, ...REPEAT_MINUTE_STEPS.filter((n) => n !== 1)] : REPEAT_HOUR_STEPS).map(
              (n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ),
            )}
          </select>
          <select
            className={`${controls.select} ${controls.selectSm}`}
            aria-label="Unit"
            value={time.unit}
            onChange={(e) =>
              setTime({
                ...time,
                unit: e.target.value as "minute" | "hour",
                every: e.target.value === "minute" ? 15 : 1,
              })
            }
          >
            <option value="minute">minutes</option>
            <option value="hour">hours</option>
          </select>
          {time.unit === "hour" && (
            <>
              <span className={styles.label}>at minute</span>
              <input
                type="number"
                min={0}
                max={59}
                className={`${`${controls.input} ${controls.inputSm}`} ${styles.minuteInput}`}
                value={time.minute}
                onChange={(e) => setTime({ ...time, minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
              />
            </>
          )}
          <span className={styles.label}>from</span>
          <select
            className={`${controls.select} ${controls.selectSm}`}
            aria-label="From"
            value={time.from}
            onChange={(e) => setTime({ ...time, from: Number(e.target.value) })}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {formatClock(h * 60)}
              </option>
            ))}
          </select>
          <span className={styles.label}>to</span>
          <select
            className={`${controls.select} ${controls.selectSm}`}
            aria-label="To"
            value={time.to}
            onChange={(e) => setTime({ ...time, to: Number(e.target.value) })}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {/* The end of that hour: a minutes repeat runs through it. */}
                {formatClock(h * 60 + (time.unit === "minute" ? 59 : time.minute))}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Days ─────────────────────────────────────────────────────────── */}
      <div className={styles.row}>
        <span className={styles.builderLabel}>Days</span>
        <select
          className={`${controls.select} ${controls.selectSm}`}
          aria-label="Days"
          value={days.kind}
          onChange={(e) => {
            const kind = e.target.value as BuilderDays["kind"];
            if (kind === "every") setDays({ kind });
            if (kind === "week") setDays({ kind, days: [1, 2, 3, 4, 5] });
            if (kind === "month") setDays({ kind, dates: [1], last: false });
            if (kind === "nth") setDays({ kind, nth: 1, day: 1 });
          }}
        >
          <option value="every">Every day</option>
          <option value="week">On certain days of the week</option>
          <option value="month">On certain dates</option>
          <option value="nth">On a weekday of the month (e.g. last Friday)</option>
        </select>
      </div>

      {days.kind === "week" && (
        <div className={styles.dayPicker} role="group" aria-label="Days of the week">
          {WEEK.map((d) => (
            <Chip
              key={d}
              on={days.days.includes(d)}
              onClick={() => setDays({ kind: "week", days: toggle(days.days, d) })}
            >
              {WEEKDAY_NAMES[d].slice(0, 3)}
            </Chip>
          ))}
        </div>
      )}

      {days.kind === "month" && (
        <div className={styles.dateGrid} role="group" aria-label="Dates">
          {DATES.map((d) => (
            <Chip
              key={d}
              on={days.dates.includes(d)}
              onClick={() => setDays({ ...days, dates: toggle(days.dates, d) })}
            >
              {String(d)}
            </Chip>
          ))}
          <Chip on={days.last} onClick={() => setDays({ ...days, last: !days.last })} label="Last day of the month">
            Last
          </Chip>
        </div>
      )}

      {days.kind === "nth" && (
        <div className={styles.row}>
          <span className={styles.label}>The</span>
          <select
            className={`${controls.select} ${controls.selectSm}`}
            aria-label="Which"
            value={String(days.nth)}
            onChange={(e) =>
              setDays({ ...days, nth: (e.target.value === "last" ? "last" : Number(e.target.value)) as Nth })
            }
          >
            {NTH_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className={`${controls.select} ${controls.selectSm}`}
            aria-label="Weekday"
            value={days.day}
            onChange={(e) => setDays({ ...days, day: Number(e.target.value) })}
          >
            {WEEK.map((d) => (
              <option key={d} value={d}>
                {WEEKDAY_NAMES[d]}
              </option>
            ))}
          </select>
          <span className={styles.label}>of the month</span>
        </div>
      )}

      {/* ── Months ───────────────────────────────────────────────────────── */}
      <div className={styles.row}>
        <span className={styles.builderLabel}>Months</span>
        <select
          className={`${controls.select} ${controls.selectSm}`}
          aria-label="Months"
          value={months.length === 12 ? "every" : "some"}
          onChange={(e) => update({ ...draft, months: e.target.value === "every" ? ALL_MONTHS : [1] })}
        >
          <option value="every">Every month</option>
          <option value="some">Only in certain months</option>
        </select>
      </div>

      {months.length < 12 && (
        <div className={styles.monthGrid} role="group" aria-label="Months">
          {ALL_MONTHS.map((m) => (
            <Chip key={m} on={months.includes(m)} onClick={() => update({ ...draft, months: toggle(months, m) })}>
              {MONTH_NAMES[m - 1].slice(0, 3)}
            </Chip>
          ))}
        </div>
      )}

      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}

      <button type="button" className={`${controls.btn} ${controls.btnLink}`} onClick={() => setRaw(true)}>
        Edit as a cron expression
      </button>
    </div>
  );
}
