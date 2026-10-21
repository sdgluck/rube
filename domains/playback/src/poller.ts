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
import { createPlexClient, realSessions } from "@rube/plex";
import { MINUTE_MS, type ConfigStore, type Clients } from "@rube/core";
import type { Db } from "@rube/db";
import type { Bandwidth } from "@rube/domain.bandwidth";
import { createStore } from "./store.ts";

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

/**
 * Recover from a restart before the first poll.
 *
 * Open rows whose last sighting predates the stale cutoff are closed as
 * `stale`: the process died mid-film and we cannot honestly say whether it
 * finished. Rows inside the cutoff are left open and simply picked up again by
 * the next diff, which is what makes a quick restart lossless.
 */

export interface PollResult {
  /** False when the tick did no work — unconfigured, backed off, or already running. */
  polled: boolean;
  opened: number;
  closed: number;
  /** Closes that counted as a completed play — what `item-watched` fires on. */
  completed: number;
  recovered: number;
}

export interface PollerDeps {
  db: Db;
  config: ConfigStore;
  clients: Clients;
  bandwidth: Bandwidth;
}
export function createPoller(deps: PollerDeps) {
  const { closeStaleSessions, recordPollSnapshot } = createStore(deps);
  const { recordBandwidthSample } = deps.bandwidth;

  // Poller state: the re-entrancy latch, the failure back-off, and whether
  // boot recovery has run. These were module-level `let`s, which is why this
  // file used to export a `resetPollerState` test seam — one process could only
  // ever have one poller, and a test had to reach in and clear it. Held in the
  // closure they belong to, a second poller is just a second call.
  let inFlight = false;
  let backoffUntil = 0;
  let bootRecovered = false;

  function recoverOpenSessions(now: number): number {
    bootRecovered = true;
    return closeStaleSessions(now);
  }

  const { getConfig } = deps.config;
  const { plexHealthCallback } = deps.clients;

  /**
   * One poll tick.
   *
   * Returns rather than throws on every expected condition (Plex unconfigured, a
   * poll already in flight, a Plex that is down) so the job runner records a
   * completed run instead of a failure — none of those are faults the operator
   * needs to see 2,880 times a day.
   */
  async function pollPlaybackOnce(signal?: AbortSignal, now: number = Date.now()): Promise<PollResult> {
    const idle: PollResult = { polled: false, opened: 0, closed: 0, completed: 0, recovered: 0 };

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
      // Excluding Rube's own simulated playback. A stress run starts real
      // Plex sessions on purpose, so without this a twenty-session ramp lands in
      // playback history as twenty plays by the server owner and puts a spike in
      // the bandwidth series that nobody caused — the tool that measures the
      // server would be corrupting the record of what the server did.
      const sessions = realSessions(await client.getActiveSessions());
      const { opened, closed, completed } = recordPollSnapshot(sessions, now);
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
      return { polled: true, opened, closed, completed, recovered };
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

  return { pollPlaybackOnce };
}
