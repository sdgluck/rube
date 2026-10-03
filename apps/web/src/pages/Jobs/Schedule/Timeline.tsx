import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import {
  describeDays,
  describeSchedule,
  formatClock,
  formatSchedule,
  MINUTE_MS,
  parseClock,
  parseSchedule,
  typicalDurationMs,
  wallClock,
  weekOccurrences,
  type JobSchedule,
  type ScheduleJob,
  type ScheduleLane,
  type SchedulePlan,
  type ScheduleSeverity,
} from "@tinkerbell/contracts";
import {
  axisTicks,
  blockSegments,
  DAY_MINUTES,
  keyStep,
  moveWeeklyDay,
  pointToMinute,
  pxToMinutes,
  snap,
  windowSegments,
  wrap,
  type TimelineSpan,
} from "./timelineMath";
import styles from "./Schedule.module.css";

/** Drag-and-drop payload type for a manual job dragged onto the timeline. */
export const MANUAL_JOB_MIME = "application/x-tinkerbell-job";

const LANES: Array<{ lane: ScheduleLane; title: string; hint: string }> = [
  {
    lane: "default",
    title: "Batch queue",
    hint: "One job at a time. A job due while another is running waits for it to finish.",
  },
  {
    lane: "interactive",
    title: "Interactive queue",
    hint: "Its own one-at-a-time queue, shared with things you start by hand.",
  },
  {
    lane: "internal",
    title: "Alongside",
    hint: "Quick jobs that run in the server itself, next to whatever else is going on.",
  },
];

interface Row {
  job: ScheduleJob;
  schedule: JobSchedule;
  /** Start minutes on the span. */
  starts: number[];
  durationMin: number;
  enabled: boolean;
  draggable: boolean;
}

export interface TimelineProps {
  jobs: ScheduleJob[];
  plan: SchedulePlan;
  span: TimelineSpan;
  timezone: string;
  now: number;
  severityByJob: Map<string, ScheduleSeverity>;
  selected: string | null;
  highlighted: ReadonlySet<string>;
  onSelect: (jobId: string) => void;
  /** `preview` while the pointer is down; the page commits on release. */
  onMove: (jobId: string, cron: string, preview: boolean) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDropManual: (jobId: string, minute: number) => void;
}

const DOT: Record<ScheduleSeverity, string> = {
  error: styles.dotError,
  warning: styles.dotWarning,
  info: styles.dotInfo,
};

const BLOCK_TONE: Record<ScheduleSeverity, string> = {
  error: styles.blockError,
  warning: styles.blockWarning,
  info: "",
};

/**
 * Whether a schedule is drawn on the timeline: anything that sits at a time of
 * day. Intervals live in the recurring list instead — a 15-minute poll is 96
 * slivers a day, which is noise rather than information.
 */
export function onTimeline(cron: string, timezone: string): boolean {
  const schedule = parseSchedule(cron);
  if (schedule.kind === "daily" || schedule.kind === "weekly") return true;
  if (schedule.kind !== "custom") return false;
  return (weekOccurrences(cron, timezone) ?? []).length > 0;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The new cron for `row` after its occurrence at `from` is moved to `to` (span minutes). */
function movedCron(row: Row, from: number, to: number, span: TimelineSpan): string | null {
  const { schedule } = row;
  if (schedule.kind === "daily") return formatSchedule({ kind: "daily", time: wrap(to) });
  if (schedule.kind === "weekly") {
    if (span === DAY_MINUTES) return formatSchedule({ ...schedule, time: wrap(to) });
    const days = moveWeeklyDay(schedule.days, Math.floor(from / DAY_MINUTES), Math.floor(to / DAY_MINUTES));
    return formatSchedule(
      days.length === 7 ? { kind: "daily", time: wrap(to) } : { kind: "weekly", days, time: wrap(to) },
    );
  }
  return null;
}

export default function Timeline(props: TimelineProps) {
  const { jobs, plan, span, timezone, now, severityByJob, selected, highlighted } = props;
  const [drag, setDrag] = useState<{ jobId: string; from: number; x: number; moved: boolean } | null>(null);
  const [dropMinute, setDropMinute] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const job of jobs) {
      const entry = plan.jobs[job.id];
      if (!entry) continue;
      if (!onTimeline(entry.schedule, timezone)) continue;
      const schedule = parseSchedule(entry.schedule);
      const week = weekOccurrences(entry.schedule, timezone) ?? [];
      const starts = span === DAY_MINUTES ? [...new Set(week.map((m) => m % DAY_MINUTES))].sort((a, b) => a - b) : week;
      out.push({
        job,
        schedule,
        starts,
        durationMin: Math.max(1, Math.round(typicalDurationMs(job) / MINUTE_MS)),
        enabled: entry.enabled,
        draggable: schedule.kind === "daily" || schedule.kind === "weekly",
      });
    }
    return out;
  }, [jobs, plan, span, timezone]);

  const window = plan.settings.maintenanceWindow;
  const windowFrom = parseClock(window.from);
  const windowTo = parseClock(window.to);
  const band =
    window.enabled && windowFrom !== null && windowTo !== null ? windowSegments(windowFrom, windowTo, span) : [];
  const ticks = axisTicks(span, span === DAY_MINUTES ? 3 : 24);
  const nowClock = wallClock(new Date(now), timezone);
  const nowMinute = span === DAY_MINUTES ? nowClock.minute : nowClock.day * DAY_MINUTES + nowClock.minute;

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, row: Row, start: number) {
    props.onSelect(row.job.id);
    if (!row.draggable || e.button !== 0) return;
    trackRef.current = (e.currentTarget.parentElement as HTMLDivElement) ?? null;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ jobId: row.job.id, from: start, x: e.clientX, moved: false });
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>, row: Row) {
    if (!drag || drag.jobId !== row.job.id || !trackRef.current) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    const to = snap(drag.from + pxToMinutes(dx, trackRef.current.clientWidth, span), 15, span);
    const cron = movedCron(row, drag.from, to, span);
    if (cron) props.onMove(row.job.id, cron, true);
    if (!drag.moved) setDrag({ ...drag, moved: true });
  }

  function onPointerUp(row: Row) {
    if (!drag || drag.jobId !== row.job.id) return;
    if (drag.moved) props.onCommit();
    setDrag(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, row: Row, start: number) {
    if (e.key === "Escape" && drag) {
      props.onCancel();
      setDrag(null);
      return;
    }
    if (!row.draggable) return;
    const step = keyStep(e.key, e.shiftKey, span);
    if (step === null) return;
    e.preventDefault();
    const cron = movedCron(row, start, wrap(start + step, span), span);
    if (cron) props.onMove(row.job.id, cron, false);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(MANUAL_JOB_MIME)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropMinute(snap(pointToMinute(e.clientX, rect, span), 15, span));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    const jobId = e.dataTransfer.getData(MANUAL_JOB_MIME);
    setDropMinute(null);
    if (!jobId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    props.onDropManual(jobId, snap(pointToMinute(e.clientX, rect, span), 15, span) % DAY_MINUTES);
  }

  const pct = (m: number) => `${(m / span) * 100}%`;
  const background = (
    <>
      {band.map((seg, i) => (
        <span
          key={`w${i}`}
          className={styles.windowBand}
          style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
          aria-hidden="true"
        />
      ))}
      {ticks.map((t) => (
        <span key={`t${t.minute}`} className={styles.gridLine} style={{ left: pct(t.minute) }} aria-hidden="true" />
      ))}
      <span className={styles.nowLine} style={{ left: pct(nowMinute) }} aria-hidden="true" />
    </>
  );

  return (
    <div className={styles.timeline} onDragOver={onDragOver} onDragLeave={() => setDropMinute(null)} onDrop={onDrop}>
      <div className={styles.timelineScroll} data-scroll="x">
        <div className={styles.timelineInner}>
          <div className={styles.axisRow}>
            <span />
            <div className={styles.axis}>
              {ticks.map((t) => (
                <span key={t.minute} className={styles.tick} style={{ left: pct(t.minute) }}>
                  {t.label}
                </span>
              ))}
              {dropMinute !== null && (
                <span className={styles.dropMarker} style={{ left: pct(dropMinute) }}>
                  {formatClock(dropMinute % DAY_MINUTES)}
                </span>
              )}
            </div>
          </div>

          {LANES.map(({ lane, title, hint }) => {
            const laneRows = rows.filter((r) => r.job.lane === lane);
            if (laneRows.length === 0) return null;
            return (
              <section key={lane} className={styles.laneGroup} aria-label={title}>
                <div className={styles.laneHeader} title={hint}>
                  {title}
                  <span className={styles.laneHint}>{hint}</span>
                </div>
                {laneRows.map((row) => {
                  const severity = severityByJob.get(row.job.id);
                  const rowClass = [
                    styles.row,
                    selected === row.job.id ? styles.rowSelected : "",
                    highlighted.has(row.job.id) ? styles.rowHighlighted : "",
                  ].join(" ");
                  return (
                    <div key={row.job.id} className={rowClass}>
                      <button type="button" className={styles.rowLabel} onClick={() => props.onSelect(row.job.id)}>
                        <span className={styles.rowName}>
                          {severity && <span className={DOT[severity]} aria-label={severity} />}
                          {row.job.name}
                        </span>
                        <span className={styles.rowMeta}>
                          {row.schedule.kind === "weekly" && span === DAY_MINUTES
                            ? `${describeDays(row.schedule.days)} · `
                            : ""}
                          {row.schedule.kind === "custom" ? describeSchedule(row.schedule) : ""}
                          {row.job.typicalMs !== null ? "~" : "est. "}
                          {formatDuration(row.durationMin)}
                          {!row.enabled && " · off"}
                        </span>
                      </button>
                      <div className={styles.track}>
                        {background}
                        {row.starts.flatMap((start, occurrence) =>
                          blockSegments(start, row.durationMin, span).map((seg, i) => (
                            <button
                              // By position, not time: a block keyed by its start remounts on every
                              // arrow-key move and drops focus after one step.
                              key={`${occurrence}-${i}`}
                              type="button"
                              role="slider"
                              aria-label={row.job.name}
                              aria-valuemin={0}
                              aria-valuemax={span - 1}
                              aria-valuenow={start}
                              aria-valuetext={`${row.job.name}, ${describeSchedule(row.schedule)}`}
                              aria-readonly={!row.draggable}
                              tabIndex={seg.continued ? -1 : 0}
                              className={[
                                styles.block,
                                row.job.typicalMs === null ? styles.blockEstimate : "",
                                row.enabled ? "" : styles.blockOff,
                                row.draggable ? styles.blockDraggable : "",
                                severity ? BLOCK_TONE[severity] : "",
                                drag?.jobId === row.job.id && drag.moved ? styles.blockDragging : "",
                              ].join(" ")}
                              style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                              title={`${row.job.name} — ${describeSchedule(row.schedule)}${
                                row.draggable ? ". Drag, or use the arrow keys, to move it." : ""
                              }`}
                              onPointerDown={(e) => onPointerDown(e, row, start)}
                              onPointerMove={(e) => onPointerMove(e, row)}
                              onPointerUp={() => onPointerUp(row)}
                              onPointerCancel={() => {
                                props.onCancel();
                                setDrag(null);
                              }}
                              onKeyDown={(e) => onKeyDown(e, row, start)}
                            >
                              {!seg.continued && seg.widthPct > (span === DAY_MINUTES ? 2.5 : 1.2) && (
                                <span className={styles.blockTime}>{formatClock(start % DAY_MINUTES)}</span>
                              )}
                            </button>
                          )),
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
