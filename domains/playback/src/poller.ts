/**
 * The playback poller.
 *
 * Samples `/status/sessions` every 30 seconds and hands the result to the state
 * machine. 30s is Tautulli's default and the right trade-off: a 22-minute
 * episode gets ~44 samples, and the cost is one small request per interval.
 *
 * Strictly additive by design — a poller failure must never affect anything
 * else in the process. Every path here either records a play or gives up
 * quietly until the next tick.
 */
import { createPlexClient } from "@tinkerbell/plex";
import { getConfig, plexHealthCallback, MINUTE_MS } from "@tinkerbell/core";
import { recordBandwidthSample } from "@tinkerbell/domain.bandwidth";
import { closeStaleSessions, recordPollSnapshot } from "./store.ts";

/**
 * Back-off applied after a failed poll.
 *
 * A Plex that is down would otherwise produce 120 identical error lines an
 * hour, which buries anything real in the log and makes the jobs UI useless.
 */
const ERROR_BACKOFF_MS = 5 * MINUTE_MS;

/**
 * Process-local poller state.
 *
 * Module scope rather than the DB because none of it is worth persisting: the
 * latch and the back-off deadline are only meaningful for the lifetime of this
 * process, and open sessions are recovered from `playback_sessions` at boot.
 */
let inFlight = false;
let backoffUntil = 0;
let bootRecovered = false;

/**
 * Recover from a restart before the first poll.
 *
 * Open rows whose last sighting predates the stale cutoff are closed as
 * `stale`: the process died mid-film and we cannot honestly say whether it
 * finished. Rows inside the cutoff are left open and simply picked up again by
 * the next diff, which is what makes a quick restart lossless.
 */
function recoverOpenSessions(now: number): number {
  bootRecovered = true;
  return closeStaleSessions(now);
}

export interface PollResult {
  /** False when the tick did no work — unconfigured, backed off, or already running. */
  polled: boolean;
  opened: number;
  closed: number;
  recovered: number;
}

/**
 * One poll tick.
 *
 * Returns rather than throws on every expected condition (Plex unconfigured, a
 * poll already in flight, a Plex that is down) so the job runner records a
 * completed run instead of a failure — none of those are faults the operator
 * needs to see 2,880 times a day.
 */
export async function pollPlaybackOnce(signal?: AbortSignal, now: number = Date.now()): Promise<PollResult> {
  const idle: PollResult = { polled: false, opened: 0, closed: 0, recovered: 0 };

  // A slow Plex must not let ticks stack up: overlapping polls would both read
  // the same open rows and both decide to open a duplicate session.
  if (inFlight) return idle;
  if (now < backoffUntil) return idle;

  const url = getConfig("global_plex_url");
  const token = getConfig("global_plex_token");
  if (!url || !token) return idle;

  inFlight = true;
  try {
    const recovered = bootRecovered ? 0 : recoverOpenSessions(now);
    const client = createPlexClient({ url, token, signal, onHealth: plexHealthCallback });
    const sessions = await client.getActiveSessions();
    const { opened, closed } = recordPollSnapshot(sessions, now);
    // What the sessions cost, alongside what they were. Written on every tick
    // including the empty ones: a gap in the series would be indistinguishable
    // from a poller that had stopped, and "nothing was streaming" is the most
    // common true answer.
    recordBandwidthSample({
      sampledAt: now,
      kbps: sessions.reduce((sum, s) => sum + (s.bandwidth ?? 0), 0),
      streams: sessions.length,
    });
    backoffUntil = 0;
    return { polled: true, opened, closed, recovered };
  } catch {
    // Deliberately swallowed. `plexHealthCallback` has already recorded the
    // failure against the Plex service, which is where an operator looks — a
    // thrown error here would additionally mark the job run failed every 30s.
    backoffUntil = now + ERROR_BACKOFF_MS;
    return idle;
  } finally {
    inFlight = false;
  }
}

/** Test seam: reset the module-local latch, back-off and boot-recovery flag. */
export function resetPollerState(): void {
  inFlight = false;
  backoffUntil = 0;
  bootRecovered = false;
}
