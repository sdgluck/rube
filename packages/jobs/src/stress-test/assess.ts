/**
 * The judgement at the heart of the harness: after adding one more session, is
 * the server still keeping up?
 *
 * Pure and separate from the ramp because it is the only part with an opinion,
 * and because the original inline version had two failures that a test would
 * have caught immediately:
 *
 *  - it keyed solely off transcode speed, which is `null` in direct-play mode.
 *    That branch could therefore *never* report degradation: a direct-play run
 *    always ramped to the configured cap and reported it as the server's
 *    capacity, whatever the server was actually doing.
 *  - a single failed `/status/sessions` call counted as degradation, so one
 *    transient 502 ended the run and understated capacity.
 */

import { STRESS_MIN_TRANSCODE_SPEED } from "../limits.ts";

export interface StepAssessment {
  degraded: boolean;
  /** Human-readable cause, recorded on the step and shown in the UI. */
  reason: string | null;
}

export interface StepMeasurement {
  /** Samples that failed outright, and how many were attempted. */
  apiErrors: number;
  sampleCount: number;
  /** Most of our sessions Plex reported at any point in the window. */
  sessionsSeen: number;
  /** How many we have running and therefore expect it to report. */
  expectedSessions: number;
  /**
   * Whether Plex has ever reported every session we had running.
   *
   * Without this, a server that simply doesn't list our sessions — direct play
   * on some setups — would read as a total dropout on step one. Requiring it to
   * have matched at least once means the signal only fires for a server that
   * *stopped* reporting them, which is what a killed stream looks like.
   */
  sessionsEverMatched: boolean;
  /** Mean transcode speed across our transcoding sessions, or null if none
   *  reported one (always the case in direct-play mode). */
  avgSpeed: number | null;
  /** Stream fetches by the simulated clients during the window. */
  streamOk: number;
  streamErrors: number;
  /** Bytes the simulated clients pulled during the window. */
  bytesRead: number;
  /**
   * Whether any traffic has ever flowed on this run.
   *
   * The stall check needs it for the same reason the session check does: a
   * client whose very first read has not completed yet has moved no bytes, and
   * that is startup, not a stall. Only a run that *was* moving data and then
   * stopped is wedged.
   */
  streamEverFlowed: boolean;
  /**
   * How long the window lasted, and the longest a healthy client may go
   * between transfers (its playlist poll cycle).
   *
   * The stall check is only meaningful when the window is at least one duty
   * cycle long. A window shorter than that can legitimately fall entirely
   * inside the gap between two polls, and concluding "no data moved" from it
   * is reading the clock, not the server — which is exactly what made the
   * confirmation re-measure report a stall on a healthy server.
   */
  windowMs: number;
  dutyCycleMs: number;
}

export function assessStep(m: StepMeasurement): StepAssessment {
  // A majority of samples failing means we've lost the ability to measure, not
  // that we measured something bad. Either way the ramp must stop, but the
  // distinction is what the reason string is for.
  if (m.apiErrors > m.sampleCount / 2) {
    return { degraded: true, reason: `Plex stopped answering (${m.apiErrors}/${m.sampleCount} samples failed)` };
  }

  if (m.avgSpeed != null && m.avgSpeed < STRESS_MIN_TRANSCODE_SPEED) {
    return { degraded: true, reason: `transcode speed ${m.avgSpeed.toFixed(2)}x is below realtime` };
  }

  // Plex not reporting sessions we know we started is the clearest sign it gave
  // up on one of our streams — and the only signal available at all when there
  // is no transcoder to measure.
  if (m.sessionsEverMatched && m.sessionsSeen < m.expectedSessions) {
    return {
      degraded: true,
      reason: `${m.expectedSessions - m.sessionsSeen} of ${m.expectedSessions} session(s) dropped out`,
    };
  }

  // Direct play has no transcoder to measure, so its health signal is whether
  // the bytes are still flowing. These count *media* fetches only, and a
  // segment the transcoder has not produced yet is not counted as a failure at
  // all — so this fires for genuine errors, not for backpressure.
  if (m.streamErrors > 0 && m.streamErrors >= m.streamOk) {
    return {
      degraded: true,
      reason: `${m.streamErrors} of ${m.streamErrors + m.streamOk} stream requests failed`,
    };
  }

  // Nothing failed, nothing succeeded, nothing moved.
  //
  // This is where a transcoder that cannot keep up ends up: every segment
  // request comes back "not ready", which is correctly not an error, but no
  // data reaches the client either. Sustained, that is a stall — the same thing
  // a viewer would see as an endless spinner.
  if (
    m.streamEverFlowed &&
    m.windowMs >= m.dutyCycleMs &&
    m.streamOk === 0 &&
    m.streamErrors === 0 &&
    m.bytesRead === 0
  ) {
    return { degraded: true, reason: "playback stalled — no data transferred" };
  }

  return { degraded: false, reason: null };
}
