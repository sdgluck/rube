/**
 * The arithmetic behind the cockpit's charts, kept out of the components that
 * draw them.
 *
 * `apps/web`'s test glob is `*.test.ts` rather than `*.tsx` on purpose — there
 * is no DOM in the suite and rendering is covered by the screenshot harness — so
 * anything worth asserting about a chart has to be extractable. These are the
 * parts with an answer that can be wrong rather than merely ugly: where a line
 * breaks, what the axis says, which sample the crosshair is over.
 */

import type { StressSample } from "./types.ts";

/** Chart-space is a fixed viewBox stretched to the container by the SVG itself,
 *  so nothing here needs to know the element's real width. */
export const CHART_W = 1000;

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * A y axis that lands on numbers a person would have chosen.
 *
 * Charts here are read for a magnitude — "about eighty megabits", "under
 * realtime" — so an axis labelled 0, 23.7, 47.4 costs the reader a subtraction
 * every time. `include` forces values into range that the data alone might not
 * reach: zero on every chart, because a bandwidth line floating above an
 * invisible floor reads as twice the load it is, and the degradation threshold
 * on the speed chart, so the line the run is judged against is always on screen.
 */
export function niceScale(values: number[], opts: { include?: number[]; ticks?: number } = {}): Scale {
  const wanted = opts.ticks ?? 4;
  const all = [...values.filter((v) => Number.isFinite(v)), ...(opts.include ?? [])];
  if (all.length === 0) return { min: 0, max: 1, ticks: [0, 1] };

  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // A flat series still needs a range, or every point lands on one pixel row
  // and a steady 40 Mbps draws the same picture as a steady 4.
  if (hi === lo) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1;
    return buildScale(lo - pad, hi + pad, wanted);
  }
  return buildScale(lo, hi, wanted);
}

function buildScale(lo: number, hi: number, wanted: number): Scale {
  const step = niceStep((hi - lo) / wanted);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Accumulating with `+= step` drifts on 0.1-sized steps and produces ticks
  // labelled 0.30000000000000004; multiplying out keeps them exact.
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) ticks.push(round(min + i * step));
  return { min: round(min), max: round(max), ticks };
}

/** 1, 2, 2.5 or 5 times a power of ten — the steps axes are conventionally cut on. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function round(n: number): number {
  // Twelve significant figures kills float noise without touching any value a
  // real reading could hold.
  return Number(n.toPrecision(12));
}

/** Where a value sits in chart space, 0 at the top edge. */
export function projectY(value: number, scale: Scale, height: number): number {
  const span = scale.max - scale.min || 1;
  return height - ((value - scale.min) / span) * height;
}

/** Where a time sits in chart space. */
export function projectX(t: number, from: number, to: number): number {
  const span = to - from || 1;
  return ((t - from) / span) * CHART_W;
}

/**
 * An SVG path through the readings, broken wherever there is not one.
 *
 * A null is not a zero. Direct play has no transcode speed at all, and a failed
 * `/status/sessions` call has no readings of any kind — drawing either as a dip
 * to the floor invents a stall that did not happen, which on a chart whose
 * entire job is to show stalls is the worst thing it could do. The line stops
 * and starts again.
 */
export function linePath(points: Array<{ x: number; y: number | null }>): string {
  let out = "";
  let open = false;
  for (const p of points) {
    if (p.y == null) {
      open = false;
      continue;
    }
    out += `${open ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    open = true;
  }
  return out.trim();
}

/**
 * A filled band between two lines — the spread between the mean transcode speed
 * and the slowest single session.
 *
 * Only spans where both lines have a reading are filled, for the same reason
 * `linePath` breaks: a band closed across a gap asserts a spread nobody measured.
 */
export function bandPath(points: Array<{ x: number; hi: number | null; lo: number | null }>): string {
  const runs: Array<Array<{ x: number; hi: number; lo: number }>> = [];
  let run: Array<{ x: number; hi: number; lo: number }> = [];
  for (const p of points) {
    if (p.hi == null || p.lo == null) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    run.push({ x: p.x, hi: p.hi, lo: p.lo });
  }
  if (run.length > 1) runs.push(run);

  return runs
    .map((segment) => {
      const top = segment.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.hi.toFixed(1)}`).join(" ");
      const bottom = [...segment]
        .reverse()
        .map((p) => `L${p.x.toFixed(1)},${p.lo.toFixed(1)}`)
        .join(" ");
      return `${top} ${bottom} Z`;
    })
    .join(" ");
}

/**
 * The sample under the pointer.
 *
 * Nearest rather than "the last one before", so hovering just past the final
 * reading still reads it out instead of blanking — a chart whose tooltip
 * disappears at the right-hand edge, which is where a live run's newest data
 * is, would be unreadable exactly when it matters.
 */
export function nearestIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < times.length; i++) {
    const gap = Math.abs(times[i] - t);
    // `<` not `<=`: on an exact tie the earlier sample wins, so the readout
    // does not flicker between two points as the pointer sits still.
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/** Contiguous spans of one phase, for the ribbon under the charts. */
export interface PhaseRun {
  phase: StressSample["phase"];
  step: number;
  from: number;
  to: number;
}

/**
 * The run's phases as spans rather than per-sample labels.
 *
 * A span ends at the *next* phase's first sample, not at its own last one, so
 * the ribbon has no gaps between bands. Sampling is periodic, so the boundary
 * really did happen somewhere in that gap and attributing it to either side is
 * equally wrong; leaving a hole would be visibly wrong.
 */
export function phaseRuns(samples: readonly StressSample[]): PhaseRun[] {
  const runs: PhaseRun[] = [];
  for (const sample of samples) {
    const last = runs.at(-1);
    if (last && last.phase === sample.phase && last.step === sample.step) {
      last.to = sample.t;
      continue;
    }
    if (last) last.to = sample.t;
    runs.push({ phase: sample.phase, step: sample.step, from: sample.t, to: sample.t });
  }
  return runs;
}

export interface Lane {
  id: string;
  /** The session's speed at each sample it appeared in, oldest first. */
  speeds: number[];
  kbps: number;
  speed: number | null;
  decision?: string;
  hw?: boolean;
  /** Still present in the most recent sample. */
  live: boolean;
}

/**
 * One row per simulated session, from the per-sample readings.
 *
 * Sessions that have ended are kept and marked dead rather than dropped: the
 * ramp's own cleanup ends every one of them, and a panel that empties itself at
 * the end of a run destroys the record of what the run did. Order is by first
 * appearance, which is the order the ramp started them and therefore the order
 * a reader is looking for.
 */
export function lanes(samples: readonly StressSample[], historyPoints = 32): Lane[] {
  const byId = new Map<string, Lane>();
  const recent = samples.slice(-historyPoints);
  const liveIds = new Set((samples.at(-1)?.sessions ?? []).map((s) => s.id));

  for (const sample of samples) {
    for (const reading of sample.sessions) {
      if (byId.has(reading.id)) continue;
      byId.set(reading.id, {
        id: reading.id,
        speeds: [],
        kbps: 0,
        speed: null,
        decision: reading.decision,
        hw: reading.hw,
        live: liveIds.has(reading.id),
      });
    }
  }

  for (const sample of recent) {
    for (const reading of sample.sessions) {
      const lane = byId.get(reading.id);
      if (!lane) continue;
      if (reading.speed != null) lane.speeds.push(reading.speed);
      lane.kbps = reading.kbps;
      lane.speed = reading.speed;
      if (reading.decision) lane.decision = reading.decision;
      if (reading.hw != null) lane.hw = reading.hw;
    }
  }

  return [...byId.values()];
}

/**
 * A bandwidth axis whose ticks all speak the same unit.
 *
 * `formatBandwidth` picks its unit per value, which is right for a single
 * figure and wrong for a column of them: an axis reading 0 kbps, 20.0 Mbps,
 * 40.0 Mbps makes the reader check whether the bottom tick is a thousandth of
 * the next one. The unit is chosen once, from the top of the scale.
 */
export function bandwidthAxis(max: number): (v: number) => string {
  if (max < 1000) return (v) => `${Math.round(v)} kbps`;
  // The decimal is decided by the scale too, not per value — otherwise the same
  // axis reads 0.0, 20, 60 and the inconsistency simply moves.
  const decimals = max >= 10_000 ? 0 : 1;
  return (v) => `${(v / 1000).toFixed(decimals)} Mbps`;
}

/** m:ss, for the elapsed axis. Runs are minutes, so an hour hand is noise. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
