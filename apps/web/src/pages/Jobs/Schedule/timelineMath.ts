/**
 * Pixels ↔ minutes for the schedule timeline, kept out of the components so
 * the arithmetic that decides where a dropped block lands can be tested
 * without a DOM. The off-by-one that matters here is the wrap: a block dragged
 * past midnight must come back at 00:15, not at 24:15 or at the far left
 * with the remainder lost.
 */
import { SNAP_MINUTES } from "@tinkerbell/contracts";

export const DAY_MINUTES = 1440;
export const WEEK_MINUTES = 7 * DAY_MINUTES;

export type TimelineSpan = typeof DAY_MINUTES | typeof WEEK_MINUTES;

/** Wrap into `[0, span)`. */
export function wrap(minutes: number, span: number = DAY_MINUTES): number {
  return ((minutes % span) + span) % span;
}

/** Nearest quarter hour, wrapped. */
export function snap(minutes: number, step = SNAP_MINUTES, span: number = DAY_MINUTES): number {
  return wrap(Math.round(minutes / step) * step, span);
}

/** A horizontal drag distance as minutes on a track `trackPx` wide. */
export function pxToMinutes(dx: number, trackPx: number, span: number = DAY_MINUTES): number {
  if (trackPx <= 0) return 0;
  return (dx / trackPx) * span;
}

/** Where on the track a pointer is, as a minute (clamped, not wrapped). */
export function pointToMinute(
  clientX: number,
  rect: { left: number; width: number },
  span: number = DAY_MINUTES,
): number {
  if (rect.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * span;
}

export interface Segment {
  leftPct: number;
  widthPct: number;
  /** True for the part that wrapped round to the start of the track. */
  continued: boolean;
}

/**
 * A block as one or two segments: a run that starts at 23:30 and takes an
 * hour is drawn from 23:30 to the right edge and again from the left edge to
 * 00:30, rather than overflowing the track.
 */
export function blockSegments(start: number, duration: number, span: number = DAY_MINUTES): Segment[] {
  const s = wrap(start, span);
  const d = Math.min(Math.max(duration, 0), span);
  const pct = (m: number) => (m / span) * 100;
  if (s + d <= span) return [{ leftPct: pct(s), widthPct: pct(d), continued: false }];
  return [
    { leftPct: pct(s), widthPct: pct(span - s), continued: false },
    { leftPct: 0, widthPct: pct(s + d - span), continued: true },
  ];
}

/** Minutes a key moves a focused block by, or null when it isn't a move key. */
export function keyStep(key: string, shift: boolean, span: number = DAY_MINUTES): number | null {
  const step = shift ? 60 : SNAP_MINUTES;
  switch (key) {
    case "ArrowLeft":
      return -step;
    case "ArrowRight":
      return step;
    // A day at a time in the week view — the only place up/down has a meaning.
    case "ArrowUp":
      return span === WEEK_MINUTES ? -DAY_MINUTES : null;
    case "ArrowDown":
      return span === WEEK_MINUTES ? DAY_MINUTES : null;
    default:
      return null;
  }
}

/**
 * A weekly job with one occurrence moved from day `from` to day `to`: the
 * other days stay put, and landing on a day it already runs merges the two.
 */
export function moveWeeklyDay(days: number[], from: number, to: number): number[] {
  const next = new Set(days.filter((d) => d !== from));
  next.add(wrap(to, 7));
  return [...next].sort((a, b) => a - b);
}

/** Tick positions for the axis: every `every` hours across the span. */
export function axisTicks(span: number, every: number): Array<{ minute: number; label: string }> {
  const out: Array<{ minute: number; label: string }> = [];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let m = 0; m < span; m += every * 60) {
    const hour = (m % DAY_MINUTES) / 60;
    out.push({
      minute: m,
      label: span === WEEK_MINUTES ? days[Math.floor(m / DAY_MINUTES)] : `${String(hour).padStart(2, "0")}:00`,
    });
  }
  return out;
}

/** The window band as segments, spanning midnight when `to < from`. */
export function windowSegments(from: number, to: number, span: number = DAY_MINUTES): Segment[] {
  const length = wrap(to - from, DAY_MINUTES) || DAY_MINUTES;
  if (span === DAY_MINUTES) return blockSegments(from, length);
  return Array.from({ length: 7 }, (_, d) => blockSegments(d * DAY_MINUTES + from, length, span)).flat();
}
