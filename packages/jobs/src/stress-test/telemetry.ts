/**
 * The stress run's time series: what was happening, second by second, rather
 * than one aggregate per session count.
 *
 * The harness always computed these numbers — per-session speed, summed
 * bandwidth, bytes genuinely pulled, stream successes and failures — and threw
 * all of them away except a rounded average per ramp step. A twenty-session run
 * therefore produced twenty points over seven minutes, and the fifteen-second
 * settle before each measurement was not merely unmeasured, it was unobservable.
 *
 * This module is the pure half of fixing that: the sample shape, the arithmetic
 * that builds one, the arithmetic that folds a span of them back into the
 * aggregate `assessStep` judges, and the thinning that keeps a long run's series
 * bounded. It lives beside `assess.ts` and `hls.ts` for the same reason they do
 * — it is a part with an opinion, and a part with an opinion that can only be
 * reached through a forked child process talking to a real Plex server is a part
 * that is never tested.
 */

import { z } from "zod";

export const stressTestSessionSampleSchema = z.object({
  /** The client identifier, minus the `rube-stress-` prefix. */
  id: z.string(),
  /** This session's transcode speed, or null in direct play. */
  speed: z.number().nullable(),
  kbps: z.number(),
  /** Plex's own word for what it is doing: transcode, copy, directplay. */
  decision: z.string().optional(),
  /** Whether Plex is using a hardware encoder for it. */
  hw: z.boolean().optional(),
});
export type StressTestSessionSample = z.infer<typeof stressTestSessionSampleSchema>;

/** Which part of a step the run was in when a sample was taken. */
export const STRESS_PHASES = ["start", "settle", "measure", "confirm", "cleanup"] as const;
export type StressTestPhase = (typeof STRESS_PHASES)[number];

export const stressTestSampleSchema = z.object({
  /**
   * Milliseconds since the run started, not an epoch timestamp. Every sample
   * carries one and a long run carries a thousand samples, so the eight bytes
   * a relative offset saves over an absolute one are eight kilobytes of JSON
   * on a column that is rewritten twice a second.
   */
  t: z.number(),
  step: z.number(),
  phase: z.enum(STRESS_PHASES),
  /** Sessions the harness believes it has running. */
  started: z.number(),
  /** Sessions Plex reported back to us. The gap between the two is the story. */
  seen: z.number(),
  /** Mean of the non-zero transcode speeds. Null when nothing is transcoding. */
  speed: z.number().nullable(),
  /** The worst single session's speed — an average hides one stalled stream. */
  speedMin: z.number().nullable(),
  /**
   * The **sum** of Plex's reported bandwidth across our sessions, in kbps.
   *
   * The step row has always stored the per-session *mean*, which cannot answer
   * "what is this server pushing right now" — the only question a bandwidth
   * reading is asked. The mean is still recorded on the step for continuity
   * with rows written before this existed; the chart draws this.
   */
  kbps: z.number(),
  /**
   * What the simulated clients actually pulled off the wire since the previous
   * sample, in kbps. Plex reporting a stream it is not delivering is precisely
   * what a server falling over looks like, and it is invisible in `kbps` alone.
   */
  actualKbps: z.number(),
  /** Media fetches since the previous sample. */
  ok: z.number(),
  err: z.number(),
  /** 404/425 on a segment: transcoder backpressure, not failure. */
  notReady: z.number(),
  /** This sample's `/status/sessions` call failed, so its readings are absent. */
  apiError: z.boolean(),
  sessions: z.array(stressTestSessionSampleSchema),
});
export type StressTestSample = z.infer<typeof stressTestSampleSchema>;

/** Cumulative client counters, as the ramp already keeps them. */
export interface StressCounters {
  ok: number;
  err: number;
  notReady: number;
  bytes: number;
}

/** The shape `buildSample` needs off a Plex session — deliberately structural,
 *  so a test can hand it an object literal. */
export interface SessionReading {
  playerMachineId?: string;
  transcodeSpeed?: number;
  bandwidth?: number;
  videoDecision?: string;
  decision?: string;
  transcodeHwEncoding?: boolean;
}

export interface BuildSampleInput {
  t: number;
  step: number;
  phase: StressTestPhase;
  started: number;
  /** Our sessions from `/status/sessions`, or null if the call failed. */
  sessions: readonly SessionReading[] | null;
  counters: StressCounters;
  prevCounters: StressCounters;
  /** Wall clock since the previous sample, for the throughput derivative. */
  elapsedMs: number;
  /** Prefix stripped from the client identifier to make lane labels short. */
  idPrefix?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildSample(input: BuildSampleInput): StressTestSample {
  const { sessions, counters, prevCounters, elapsedMs } = input;

  const bytesDelta = Math.max(0, counters.bytes - prevCounters.bytes);
  // kbps from a byte delta: bits over milliseconds already *is* kilobits over
  // seconds, so the two thousands cancel and there is no unit conversion here
  // to get wrong.
  const actualKbps = elapsedMs > 0 ? Math.round((bytesDelta * 8) / elapsedMs) : 0;

  const readings: StressTestSessionSample[] = (sessions ?? []).map((s) => ({
    id: stripPrefix(s.playerMachineId ?? "", input.idPrefix),
    // Zero means the transcoder is still filling its buffer, not that it has
    // stalled. Recording it as null keeps it out of the mean for the same
    // reason the ramp has always excluded it.
    speed: s.transcodeSpeed != null && s.transcodeSpeed > 0 ? round2(s.transcodeSpeed) : null,
    kbps: Math.round(s.bandwidth ?? 0),
    decision: s.videoDecision ?? s.decision,
    hw: s.transcodeHwEncoding,
  }));

  const speeds = readings.map((r) => r.speed).filter((v): v is number => v != null);

  return {
    t: input.t,
    step: input.step,
    phase: input.phase,
    started: input.started,
    seen: readings.length,
    speed: speeds.length > 0 ? round2(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null,
    speedMin: speeds.length > 0 ? Math.min(...speeds) : null,
    kbps: readings.reduce((n, r) => n + r.kbps, 0),
    actualKbps,
    ok: Math.max(0, counters.ok - prevCounters.ok),
    err: Math.max(0, counters.err - prevCounters.err),
    notReady: Math.max(0, counters.notReady - prevCounters.notReady),
    apiError: sessions === null,
    sessions: readings,
  };
}

function stripPrefix(id: string, prefix?: string): string {
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/**
 * What a measurement window looked like, folded back out of the samples that
 * fall inside it.
 *
 * The ramp used to issue its own `/status/sessions` calls inside the window and
 * aggregate them privately, which meant the number the health verdict was
 * formed from and the number anyone could see were separate measurements of the
 * same thing. They are the same readings now, so the chart and the verdict
 * cannot disagree about what happened.
 */
export interface WindowAggregate {
  sampleCount: number;
  apiErrors: number;
  sessionsSeen: number;
  avgSpeed: number | null;
  /** Mean per-session bandwidth. The historical `avgBandwidth` semantics. */
  avgBandwidth: number;
  /** Mean summed bandwidth across our sessions — what the server is pushing. */
  totalKbps: number;
  /** Mean of what the clients actually pulled. */
  actualKbps: number;
}

export function aggregateWindow(samples: readonly StressTestSample[], fromT: number, toT: number): WindowAggregate {
  const inWindow = samples.filter((s) => s.t >= fromT && s.t <= toT);
  const good = inWindow.filter((s) => !s.apiError);

  const speeds = good.map((s) => s.speed).filter((v): v is number => v != null);

  // Per-session mean over every (sample, session) pair — the same arithmetic the
  // ramp did inline, so a step row written now is comparable with one written
  // before the series existed.
  let sessionKbpsTotal = 0;
  let sessionKbpsCount = 0;
  for (const s of good) {
    for (const r of s.sessions) {
      sessionKbpsTotal += r.kbps;
      sessionKbpsCount++;
    }
  }

  const mean = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  return {
    sampleCount: inWindow.length,
    apiErrors: inWindow.length - good.length,
    sessionsSeen: good.reduce((max, s) => Math.max(max, s.seen), 0),
    avgSpeed: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
    avgBandwidth: sessionKbpsCount > 0 ? sessionKbpsTotal / sessionKbpsCount : 0,
    totalKbps: mean(good.map((s) => s.kbps)),
    actualKbps: mean(good.map((s) => s.actualKbps)),
  };
}

/**
 * Thin a series that has outgrown its cap, by halving the resolution of its
 * older half rather than dropping its tail.
 *
 * A ring buffer would keep the last N samples, which for this series is the
 * wrong N: the interesting part of a stress run is the shape of the whole ramp,
 * and a tail-truncated series has lost exactly the early, healthy readings that
 * the late, degraded ones are only meaningful against. Halving instead means an
 * hour-long run keeps a coarse account of its beginning and a fine one of its
 * end, which is the trade anyone reading it would make.
 *
 * The first and last samples always survive, so the run's span never shrinks.
 */
export function decimate(samples: readonly StressTestSample[], cap: number): StressTestSample[] {
  if (samples.length <= cap) return [...samples];
  // Below four there is no old half to thin, and the loop below would not
  // converge. A cap that small is a test's, not production's.
  if (cap < 4) return samples.slice(-cap);

  let out = [...samples];
  while (out.length > cap) {
    const half = Math.floor(out.length / 2);
    const thinned: StressTestSample[] = [];
    for (let i = 0; i < half; i++) if (i % 2 === 0) thinned.push(out[i]);
    for (let i = half; i < out.length; i++) thinned.push(out[i]);
    if (thinned.length >= out.length) break;
    out = thinned;
  }
  return out;
}
