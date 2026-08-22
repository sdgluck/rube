/**
 * The stress harness: how many concurrent streams will this Plex server serve?
 *
 * It answers that by being honest — real transcode sessions, real HLS segment
 * fetches, real timeline reports — and ramping one session at a time until the
 * server stops keeping up. Simulating the load with API calls alone would
 * measure nothing anyone cares about.
 *
 * Two structural notes, both scars:
 *
 *  - The run happens in a forked child (`worker.ts`) rather than on the API
 *    process. A saturating load generator sharing an event loop with the admin
 *    API means the UI stops answering exactly when you most want to watch it.
 *  - The parts with an opinion — playlist resolution (`hls.ts`) and the
 *    degradation judgement (`assess.ts`) — live in their own modules so they
 *    can be tested without a Plex server. Both were wrong for months while
 *    inline here, because nothing could reach them.
 */

import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";
import { randomUUID } from "node:crypto";
import { createLogger, errorMessage } from "@tinkerbell/core";
import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { stressTestRuns } from "@tinkerbell/db";
import type { PlexClient, PlexMediaDetail, PlexSession } from "@tinkerbell/plex";
import { SYNTHETIC_CLIENT_PREFIX, syntheticSessions } from "@tinkerbell/plex";

import type { JobContext } from "@tinkerbell/core";
import { isMasterPlaylist, resolveSegmentUrls, resolveVariantUrl } from "./hls.ts";
import { assessStep } from "./assess.ts";
import {
  aggregateWindow,
  buildSample,
  decimate,
  stressTestSampleSchema,
  type StressCounters,
  type StressTestPhase,
  type StressTestSample,
} from "./telemetry.ts";
import {
  STRESS_CANCEL_GRACE_MS,
  STRESS_CONFIRM_SETTLE_MS,
  STRESS_DEFAULT_SESSIONS,
  STRESS_DIRECT_GAP_MS,
  STRESS_DIRECT_READ_MS,
  STRESS_FALLBACK_DURATION_MS,
  STRESS_MAX_SESSIONS,
  STRESS_PLAYLIST_POLL_MS,
  STRESS_POOL_FACTOR,
  STRESS_SAMPLE_COUNT,
  STRESS_SAMPLE_INTERVAL_MS,
  STRESS_SEGMENTS_PER_POLL,
  STRESS_STABILISE_MS,
  STRESS_TELEMETRY_MAX_SAMPLES,
  STRESS_TIMELINE_INTERVAL_MS,
  STRESS_WORKER_STARTUP_MS,
} from "../limits.ts";

const log = createLogger("stress-test");

/**
 * The waits that make a ramp take minutes.
 *
 * Overridable so an integration test can drive the whole ramp against a mock
 * server in milliseconds. Production never passes these — the defaults are the
 * documented constants in `limits.ts` and are the only values that produce a
 * meaningful measurement.
 */
export interface StressTimings {
  stabiliseMs: number;
  sampleCount: number;
  sampleIntervalMs: number;
  /** Gap before the confirmation window that re-measures a degraded step. */
  confirmSettleMs: number;
}

const DEFAULT_TIMINGS: StressTimings = {
  stabiliseMs: STRESS_STABILISE_MS,
  sampleCount: STRESS_SAMPLE_COUNT,
  sampleIntervalMs: STRESS_SAMPLE_INTERVAL_MS,
  confirmSettleMs: STRESS_CONFIRM_SETTLE_MS,
};

export interface RunStressTestOptions {
  /** Existing row to write the result into, rather than minting a new one. */
  resultId?: string;
  timings?: Partial<StressTimings>;
  /**
   * Called for every telemetry sample as it is taken.
   *
   * A callback in the options bag rather than a field on `JobContext`: that
   * context is shared with every other job in the system, and none of them has
   * a time series. The worker's implementation buffers these and writes them to
   * the run row on the same tick that flushes the log.
   */
  onSample?: (sample: StressTestSample) => void;
}

/**
 * What a stored run's config may look like — deliberately unbounded, because it
 * also parses rows written by older versions. Input validation uses
 * `stressTestConfigInputSchema` instead; a bound belongs on the write path, not
 * on a read that would otherwise throw over history it cannot change.
 */
export const stressTestConfigSchema = z.object({
  mode: z.enum(["transcode", "directplay", "mixed"]),
  transcodePct: z.number().optional(),
  maxSessions: z.number().optional(),
  /** Puts per-session diagnostics in the run log. Off by default: they used to
   *  be unconditional for the first two steps, which read as noise. */
  verbose: z.boolean().optional(),
});
export type StressTestConfig = z.infer<typeof stressTestConfigSchema>;

/** The bounded form the API accepts. See `stressTestConfigSchema`. */
export const stressTestConfigInputSchema = z.object({
  mode: z.enum(["transcode", "directplay", "mixed"]),
  transcodePct: z.number().int().min(0).max(100).optional(),
  maxSessions: z.number().int().min(1).max(STRESS_MAX_SESSIONS).optional(),
  verbose: z.boolean().optional(),
});

export const stressTestStepSchema = z.object({
  step: z.number(),
  sessions: z.number(),
  avgTranscodeSpeed: z.number().nullable(),
  /**
   * Mean bandwidth **per session**, kbps.
   *
   * Kept with its original meaning so a step written today is comparable with
   * one written before the telemetry series existed. It is not the number to
   * read to learn what the server is pushing — that is `totalKbps`, which this
   * grew alongside rather than replaced.
   */
  avgBandwidth: z.number(),
  /** Failed `/status/sessions` samples. */
  errors: z.number(),
  timestamp: z.number(),
  // Optional: added after rows already existed, so absence means "not recorded"
  // rather than zero.
  sessionsSeen: z.number().optional(),
  streamErrors: z.number().optional(),
  reason: z.string().nullable().optional(),
  /** Summed reported bandwidth across our sessions, kbps — the server's load. */
  totalKbps: z.number().optional(),
  /** What the clients actually pulled off the wire over the window, kbps. */
  actualKbps: z.number().optional(),
  /** Successful media fetches during the window, the counterpart to `streamErrors`. */
  streamOk: z.number().optional(),
  /** Segment 404/425s: transcoder backpressure, deliberately not an error. */
  notReady: z.number().optional(),
  /** Bytes pulled during the window. */
  bytesRead: z.number().optional(),
});
export type StressTestStep = z.infer<typeof stressTestStepSchema>;

export interface StressTestResult {
  config: StressTestConfig;
  maxSessions: number;
  steps: StressTestStep[];
  startedAt: number;
  finishedAt: number;
  /**
   * The run's time series, thinned to the cap.
   *
   * Written here as well as by the worker's flush tick so that a run driven
   * directly — an integration test, or anything that calls `runStressTest`
   * without forking — still lands its telemetry on the row.
   */
  telemetry: StressTestSample[];
}

/**
 * The prefix stamped on every simulated player, so the run can find its own
 * sessions among everyone else's.
 *
 * Defined in `@tinkerbell/plex` rather than here, because it is now load-bearing
 * in the other direction too: the poller, the stats router and the bandwidth
 * test all use it to *exclude* these sessions from what they report, and those
 * live below this package. See `clients/plex/src/synthetic.ts`.
 */
const CLIENT_PREFIX = SYNTHETIC_CLIENT_PREFIX;

/**
 * One fake Plex player: a client identifier Plex will treat as a distinct
 * device, a stream it actually pulls bytes from, and a timeline heartbeat so
 * the session stays alive and visible in `/status/sessions`.
 */
class SimulatedClient {
  readonly clientId: string;
  readonly sessionId: string;
  private controller = new AbortController();
  private mode: "transcode" | "directplay" = "transcode";
  private running = false;
  private ratingKey = "";
  private duration = 0;
  private timelineTimer: ReturnType<typeof setInterval> | null = null;
  private playbackTime = 0;
  /** Byte offset the direct-play reader has walked to. */
  private byteOffset = 0;
  /**
   * Counters the ramp samples to judge health. Cumulative; the ramp takes
   * deltas across its measurement window rather than resetting them, so a read
   * in flight across a step boundary isn't lost.
   *
   * `streamOk`/`streamErrors` count *media* fetches only — segments and
   * direct-play reads — not playlist polls, so they measure throughput rather
   * than liveness.
   *
   * `notReady` is separate from `streamErrors` on purpose. A 404 on a segment
   * means the transcoder has not produced it yet, which is backpressure, not
   * failure — every session emits a handful while it spins up. Counting those
   * as errors made a healthy four-session ramp look like a server falling over
   * (15 "failures" against 14 successes, all of them 404s). Persistent
   * not-ready still registers, as zero bytes moved.
   */
  streamOk = 0;
  streamErrors = 0;
  notReady = 0;
  bytesRead = 0;
  /**
   * What the server said the last time a request failed.
   *
   * Surfaced in the step's reason, because "10 of 20 stream requests failed" is
   * not actionable and "HTTP 404" is: it tells you Plex reaped the session
   * rather than the transfer breaking down.
   */
  lastFailure: string | null = null;
  log: ((msg: string) => void) | null = null;

  constructor() {
    this.clientId = CLIENT_PREFIX + randomUUID().slice(0, 8);
    this.sessionId = randomUUID();
  }

  async start(ratingKey: string, mode: "transcode" | "directplay", client: PlexClient): Promise<void> {
    this.mode = mode;
    this.ratingKey = ratingKey;
    this.running = true;

    // One metadata fetch, reused by both branches: duration for the timeline
    // reports, and the part URL for direct play.
    const detail = await client.getItemDetail(ratingKey);
    this.duration = detail.duration || STRESS_FALLBACK_DURATION_MS;

    if (mode === "transcode") {
      await this.startTranscode(ratingKey, client);
    } else {
      this.startDirectPlay(detail, client);
    }

    // Report initial "playing" state (include session for transcode so Plex
    // maintains the association).
    const session = this.mode === "transcode" ? this.sessionId : undefined;
    await client.reportTimeline(ratingKey, this.clientId, {
      state: "playing",
      time: 0,
      duration: this.duration,
      session,
    });

    // Plex expires a session that stops reporting, so this heartbeat is what
    // keeps the session countable for the rest of the run.
    this.timelineTimer = setInterval(() => {
      if (!this.running) return;
      this.playbackTime += STRESS_TIMELINE_INTERVAL_MS;
      void client
        .reportTimeline(this.ratingKey, this.clientId, {
          state: "playing",
          time: this.playbackTime,
          duration: this.duration,
          session,
        })
        .catch(() => {
          // Best-effort: a missed heartbeat shows up as a dropped session,
          // which is a signal the ramp already reads.
        });
    }, STRESS_TIMELINE_INTERVAL_MS);
  }

  private async startTranscode(ratingKey: string, client: PlexClient): Promise<void> {
    const masterM3u8 = await client.startTranscodeSession(ratingKey, this.sessionId, this.clientId);
    this.log?.(`  master playlist: ${masterM3u8.length} chars`);

    if (!isMasterPlaylist(masterM3u8)) {
      throw new Error("Expected a master playlist from start.m3u8 but got a media playlist");
    }

    // Resolved against the start.m3u8 URL, so both relative variant names and
    // the absolute URLs Plex often emits come out correct.
    const base = client.resolveStreamUrl("/video/:/transcode/universal/start.m3u8");
    const mediaPlaylistUrl = resolveVariantUrl(masterM3u8, base);
    this.log?.(`  following variant playlist: ${mediaPlaylistUrl}`);

    void this.hlsLoop(mediaPlaylistUrl, client);
  }

  private startDirectPlay(detail: PlexMediaDetail, client: PlexClient): void {
    // The Part `key`, not `file` — `file` is the path on the server's own disk
    // and is not fetchable. The old code checked `file` for presence and then
    // streamed a guessed URL, which is two ways to be wrong at once.
    const partKey = detail.media?.[0]?.parts?.[0]?.key;
    if (!partKey) {
      throw new Error(`No playable part found for item ${this.ratingKey}`);
    }
    void this.directPlayLoop(partKey, client);
  }

  /**
   * Direct play: walk through the file with a moving byte offset.
   *
   * The offset matters. Re-reading from byte 0 every couple of seconds — which
   * is what this used to do — measures the same opening seconds out of the
   * server's page cache forever, and reports it as direct-play capacity.
   */
  private async directPlayLoop(partKey: string, client: PlexClient): Promise<void> {
    const signal = this.controller.signal;

    while (this.running && !signal.aborted) {
      try {
        const res = await client.fetchStreamUrl(partKey, this.clientId, signal, this.byteOffset);
        if (!res.ok && res.status !== 206) {
          this.streamErrors++;
          this.lastFailure = `HTTP ${res.status} on the media file`;
          // A range past the end means we've walked the whole file; start over.
          if (res.status === 416) this.byteOffset = 0;
          await res.body?.cancel();
        } else {
          await this.drain(res, STRESS_DIRECT_READ_MS);
          this.streamOk++;
        }
      } catch {
        if (signal.aborted) break;
        this.streamErrors++;
      }
      await this.sleepAbortable(STRESS_DIRECT_GAP_MS);
    }
  }

  /**
   * HLS: poll the media playlist and consume segments at roughly playback pace.
   *
   * Position is a *high-water index* into the playlist rather than a set of
   * URLs already seen. Plex serves the whole segment list, not a sliding
   * window, so a URL set needs either unbounded memory or an eviction policy —
   * and evicting anything the playlist still lists makes the client re-fetch it
   * forever. Both mistakes have been made here; an index has neither problem
   * and is what "how far through the file are we" actually means.
   *
   * A failed segment does not advance the index. Running ahead of the
   * transcoder returns 404s, and the right response to "not ready yet" is to
   * ask again on the next poll, not to skip it and keep going.
   */
  private async hlsLoop(playlistUrl: string, client: PlexClient): Promise<void> {
    const signal = this.controller.signal;
    let consumed = 0;

    while (this.running && !signal.aborted) {
      try {
        const res = await client.fetchStreamUrl(playlistUrl, this.clientId, signal);
        if (!res.ok) {
          // Say what the server said. A run whose streams are failing is
          // useless without the status behind it, and this is the only place
          // that knows it.
          this.streamErrors++;
          this.lastFailure = `HTTP ${res.status} on the media playlist`;
          this.log?.(`  playlist poll failed: HTTP ${res.status} ${playlistUrl}`);
          await res.body?.cancel();
        } else {
          const m3u8 = await res.text();

          const segments = resolveSegmentUrls(m3u8, playlistUrl);
          const batch = segments.slice(consumed, consumed + STRESS_SEGMENTS_PER_POLL);

          for (const segUrl of batch) {
            if (signal.aborted || !this.running) break;
            try {
              const segRes = await client.fetchStreamUrl(segUrl, this.clientId, signal);
              if (!segRes.ok) {
                // 404/425: the transcoder is behind us. Ask again next poll
                // rather than skipping the segment or calling it a failure.
                if (segRes.status === 404 || segRes.status === 425) this.notReady++;
                else {
                  this.streamErrors++;
                  this.lastFailure = `HTTP ${segRes.status} on a segment`;
                  this.log?.(`  segment failed: HTTP ${segRes.status} ${segUrl}`);
                }
                await segRes.body?.cancel();
                break;
              }
              await this.drain(segRes);
              this.streamOk++;
              consumed++;
            } catch (err) {
              if (signal.aborted) break;
              this.streamErrors++;
              this.lastFailure = errorMessage(err);
              this.log?.(`  segment error: ${errorMessage(err)}`);
              break;
            }
          }

          // Reached the end of the playlist: loop back and play it again, so a
          // long ramp doesn't quietly stop generating load partway through.
          if (consumed >= segments.length && segments.length > 0) consumed = 0;
        }
      } catch {
        if (signal.aborted) break;
        this.streamErrors++;
      }

      await this.sleepAbortable(STRESS_PLAYLIST_POLL_MS);
    }
  }

  /**
   * Read a response body, counting bytes, optionally stopping after `budgetMs`.
   *
   * Always cancels rather than only releasing the lock: an undrained body holds
   * its socket open, so a hundred abandoned reads is a hundred connections the
   * server is still paying for — noise in the very measurement being taken.
   */
  private async drain(res: Response, budgetMs?: number): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const deadline = budgetMs != null ? Date.now() + budgetMs : Infinity;
    const signal = this.controller.signal;
    let finished = false;
    try {
      while (this.running && !signal.aborted && Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        if (value) {
          this.bytesRead += value.byteLength;
          this.byteOffset += value.byteLength;
        }
      }
    } catch {
      // A torn-down stream is expected on abort.
    } finally {
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private sleepAbortable(ms: number): Promise<void> {
    return sleep(ms, this.controller.signal);
  }

  async stop(client: PlexClient): Promise<void> {
    this.running = false;
    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
      this.timelineTimer = null;
    }
    this.controller.abort();

    try {
      await client.reportTimeline(this.ratingKey, this.clientId, {
        state: "stopped",
        time: this.playbackTime,
        duration: this.duration,
        session: this.mode === "transcode" ? this.sessionId : undefined,
      });
    } catch {
      // Best-effort.
    }

    if (this.mode === "transcode") {
      await client.stopTranscodeSession(this.sessionId);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// --- Child process runner ---

/**
 * Process-level: this is a handle on a child process, and there is one of those
 * per process however many containers exist.
 *
 * `exiting` marks a child that has been asked to stop but has not yet gone. The
 * handle is kept until `exit` actually fires, because nulling it at cancel time
 * let a second `start` fork a concurrent harness while the first was still
 * pulling streams.
 */
let activeStressTest: { id: string; child: ChildProcess; startedAt: number; exiting: boolean } | null = null;

/**
 * Kill any in-flight stress-test child. Called from the server's shutdown path:
 * a forked child is not killed with its parent, so without this a restart
 * leaves a load generator hammering someone's Plex server with no UI left that
 * knows about it.
 */
export function stopStressTest(): void {
  if (!activeStressTest) return;
  if (activeStressTest.child.exitCode === null) activeStressTest.child.kill();
  activeStressTest = null;
}

export const createStressTest = perDeps(function createStressTest(deps: Pick<Services, "config" | "db">) {
  const { config, db } = deps;
  const { getConfig } = config;

  async function runStressTest(
    client: PlexClient,
    config: StressTestConfig,
    ctx: JobContext,
    opts: RunStressTestOptions = {},
  ): Promise<StressTestResult> {
    const { resultId } = opts;
    const timings: StressTimings = { ...DEFAULT_TIMINGS, ...opts.timings };
    const maxSessions = Math.min(config.maxSessions ?? STRESS_DEFAULT_SESSIONS, STRESS_MAX_SESSIONS);
    const transcodePct = config.mode === "mixed" ? (config.transcodePct ?? 50) : config.mode === "transcode" ? 100 : 0;
    const poolTarget = maxSessions * STRESS_POOL_FACTOR;

    const startedAt = Date.now();
    const steps: StressTestStep[] = [];
    const clients: SimulatedClient[] = [];

    ctx.log("Fetching library sections...");
    const sections = await client.getSections();
    const movieSections = sections.filter((s) => s.type === "movie");
    const showSections = sections.filter((s) => s.type === "show");

    if (movieSections.length === 0 && showSections.length === 0) {
      throw new Error("No movie or show sections found in Plex library");
    }

    // Collect directly playable items (movies or episodes).
    //
    // Only *never-watched* ones are eligible, and that is a correctness
    // requirement rather than tidiness: the run unscrobbles everything it
    // touched at the end, so admitting an already-watched movie here would
    // permanently clear the user's watched flag on it. Filtering on
    // `viewOffset` alone — which is all this used to do — missed exactly that
    // case, because a finished movie has a view count and no offset.
    ctx.log("Gathering unwatched media items for test...");
    const ratingKeys: string[] = [];
    let skippedWatched = 0;

    async function addIfUnwatched(ratingKey: string): Promise<void> {
      if (ratingKeys.length >= poolTarget) return;
      try {
        const detail = await client.getItemDetail(ratingKey);
        if ((detail.viewOffset ?? 0) > 0 || (detail.viewCount ?? 0) > 0) {
          skippedWatched++;
          return;
        }
        ratingKeys.push(ratingKey);
      } catch {
        // An item we can't read is an item we can't play.
      }
    }

    for (const section of movieSections) {
      if (ratingKeys.length >= poolTarget) break;
      const result = await client.getItems(section.key, { offset: 0, size: 100 });
      for (const item of result.items) {
        if (ratingKeys.length >= poolTarget) break;
        await addIfUnwatched(item.ratingKey);
      }
    }

    if (ratingKeys.length < poolTarget) {
      for (const section of showSections) {
        if (ratingKeys.length >= poolTarget) break;
        const result = await client.getItems(section.key, { offset: 0, size: 10 });
        for (const show of result.items) {
          if (ratingKeys.length >= poolTarget) break;
          try {
            const seasons = await client.getMetadataChildren(show.ratingKey);
            if (seasons.length === 0) continue;
            const episodes = await client.getMetadataChildren(seasons[0].ratingKey);
            for (const ep of episodes.slice(0, 5)) {
              if (ratingKeys.length >= poolTarget) break;
              await addIfUnwatched(ep.ratingKey);
            }
          } catch {
            // Skip shows that fail metadata fetch.
          }
        }
      }
    }

    if (ratingKeys.length === 0) {
      throw new Error(
        "No unwatched playable media items found. The harness only uses never-watched items so it can safely undo its own watch history.",
      );
    }

    if (skippedWatched > 0) {
      ctx.log(`Skipped ${skippedWatched} already-watched item(s) to avoid touching watch history`);
    }

    for (let i = ratingKeys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ratingKeys[i], ratingKeys[j]] = [ratingKeys[j], ratingKeys[i]];
    }

    ctx.log(`Found ${ratingKeys.length} unwatched media item(s) for testing`);
    ctx.log(`Mode: ${config.mode}, Max sessions: ${maxSessions}`);
    if (config.mode === "mixed") {
      ctx.log(`Transcode/DirectPlay ratio: ${transcodePct}/${100 - transcodePct}`);
    }

    let maxHealthySessions = 0;
    let sessionsEverMatched = false;
    let streamEverFlowed = false;
    /** Steps where a bad window failed to reproduce; reported at the end. */
    let transientSteps = 0;
    const usedRatingKeys = new Set<string>();

    /**
     * The run's telemetry, sampled continuously from here until cleanup has
     * finished.
     *
     * This used to be three `/status/sessions` calls per step, issued inside
     * the measurement window and discarded once the window had been judged. The
     * fifteen-second settle before each of them — most of the run's wall clock —
     * queried nothing, so the run was not merely unmeasured while it stabilised,
     * it was unobservable, and the tool that exists to show a server's capacity
     * curve produced one point every twenty seconds.
     *
     * The ticker is now the run's clock. It samples at the same cadence the
     * measurement window always used, never idles, and the measurement window
     * reads *its* samples rather than issuing calls of its own. So the number
     * the verdict is formed from and the number on the chart are the same
     * reading, which they previously were not.
     */
    const counters = (): StressCounters => ({
      ok: clients.reduce((n, c) => n + c.streamOk, 0),
      err: clients.reduce((n, c) => n + c.streamErrors, 0),
      notReady: clients.reduce((n, c) => n + c.notReady, 0),
      bytes: clients.reduce((n, c) => n + c.bytesRead, 0),
    });

    const samples: StressTestSample[] = [];
    let phase: StressTestPhase = "start";
    let phaseStep = 0;
    let prevCounters = counters();
    let prevSampleAt = startedAt;
    let sampling = false;
    /** Resolvers waiting on `collect`, notified once per appended sample. */
    let waiters: Array<() => void> = [];

    async function takeSample(): Promise<void> {
      // A slow `/status/sessions` must not queue a second call behind itself:
      // the point of a fixed cadence is that a struggling server produces
      // *fewer* samples, not a backlog of them arriving at once.
      if (sampling) return;
      sampling = true;
      try {
        let ours: PlexSession[] | null = null;
        try {
          const all = await client.getActiveSessions();
          ours = syntheticSessions(all);
          if (ours.length === 0 && all.length > 0 && !sessionsEverMatched && phase !== "start") {
            ctx.log(`  Warning: ${all.length} session(s) found but none matched prefix "${CLIENT_PREFIX}"`);
          }
        } catch {
          // Recorded as `apiError` on the sample rather than thrown: losing the
          // ability to measure is itself a reading, and `assessStep` ranks it
          // above whatever else the window saw.
          ours = null;
        }

        const at = Date.now();
        const current = counters();
        const sample = buildSample({
          t: at - startedAt,
          step: phaseStep,
          phase,
          started: clients.length,
          sessions: ours,
          counters: current,
          prevCounters,
          elapsedMs: at - prevSampleAt,
          idPrefix: CLIENT_PREFIX,
        });
        prevCounters = current;
        prevSampleAt = at;
        samples.push(sample);
        opts.onSample?.(sample);
      } finally {
        sampling = false;
        const woken = waiters;
        waiters = [];
        for (const resolve of woken) resolve();
      }
    }

    const sampleTimer = setInterval(() => void takeSample(), timings.sampleIntervalMs);
    // Nothing should be kept alive by the sampler: if the ramp has unwound, the
    // process is finished with it.
    sampleTimer.unref?.();

    /** Wait until `n` further samples have landed, or the run is aborted. */
    function collect(n: number): Promise<void> {
      let remaining = n;
      return new Promise<void>((resolve) => {
        if (ctx.signal.aborted) return resolve();
        const onAbort = () => resolve();
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        const step = () => {
          if (--remaining <= 0) {
            ctx.signal.removeEventListener("abort", onAbort);
            resolve();
          } else {
            waiters.push(step);
          }
        };
        waiters.push(step);
      });
    }

    function setPhase(next: StressTestPhase, stepNumber: number): void {
      phase = next;
      phaseStep = stepNumber;
    }

    try {
      for (let step = 1; step <= maxSessions; step++) {
        if (ctx.signal.aborted) break;

        const useTranscode = Math.random() * 100 < transcodePct;
        const clientMode: "transcode" | "directplay" = useTranscode ? "transcode" : "directplay";

        const ratingKey = ratingKeys[(step - 1) % ratingKeys.length];
        const simClient = new SimulatedClient();
        if (config.verbose) simClient.log = (msg) => ctx.log(msg);

        ctx.log(`Step ${step}: Starting ${clientMode} session (${simClient.clientId})`);
        ctx.progress(step, maxSessions + 1, `Starting session ${step}/${maxSessions}`);

        try {
          await simClient.start(ratingKey, clientMode, client);
          clients.push(simClient);
          usedRatingKeys.add(ratingKey);
        } catch (err) {
          // Stop it before giving up on it: `start` can throw after the
          // transcode session and heartbeat already exist, and a client that
          // never made it into `clients` is one the cleanup below will not see.
          await simClient.stop(client).catch(() => {});
          const reason = `failed to start session: ${errorMessage(err)}`;
          ctx.log(`Step ${step}: ${reason}`);
          steps.push({
            step,
            sessions: clients.length,
            avgTranscodeSpeed: null,
            avgBandwidth: 0,
            errors: 1,
            timestamp: Date.now(),
            sessionsSeen: 0,
            streamErrors: 0,
            reason,
          });
          break;
        }

        /**
         * One measurement window: settle, then measure.
         *
         * A window is a closure because a degraded step is measured twice
         * before it is believed.
         *
         * Two spans, deliberately different, and the difference is load-bearing:
         *
         * - The **stream counters** are snapshotted before the settle, so their
         *   deltas span the whole window. Measuring throughput only across the
         *   sampling span can miss an entire playlist poll cycle and read the
         *   idle gap between segment fetches as a stall.
         * - The **session readings** — speed, bandwidth, how many sessions Plex
         *   admits to — come only from the measuring span. A Plex transcoder
         *   reports speed=0 for its first several seconds, and folding the
         *   settle into the average is reading startup latency as saturation,
         *   which is the whole reason the settle exists.
         *
         * Neither span issues requests any more. The run-long ticker is
         * sampling throughout regardless, so the window waits for the number of
         * samples it wants and then reads them.
         */
        async function measureWindow(settleMs: number, measurePhase: StressTestPhase) {
          const windowStart = Date.now();
          const okBefore = clients.reduce((n, c) => n + c.streamOk, 0);
          const errBefore = clients.reduce((n, c) => n + c.streamErrors, 0);
          const notReadyBefore = clients.reduce((n, c) => n + c.notReady, 0);
          const bytesBefore = clients.reduce((n, c) => n + c.bytesRead, 0);

          setPhase("settle", step);
          await sleep(settleMs, ctx.signal);

          setPhase(measurePhase, step);
          const measureFrom = Date.now() - startedAt;
          await collect(timings.sampleCount);
          const measureTo = Date.now() - startedAt;

          const agg = aggregateWindow(samples, measureFrom, measureTo);
          const { apiErrors, sessionsSeen, avgSpeed, avgBandwidth, totalKbps, actualKbps } = agg;

          if (config.verbose) {
            const last = samples.at(-1);
            ctx.log(`  Sampled ${agg.sampleCount} time(s), ${sessionsSeen} of our session(s) visible to Plex`);
            for (const r of last?.sessions ?? []) {
              ctx.log(`    ${r.id} decision=${r.decision ?? "?"} speed=${r.speed ?? "n/a"} bw=${r.kbps}kbps`);
            }
          }

          const streamOk = clients.reduce((n, c) => n + c.streamOk, 0) - okBefore;
          const streamErrors = clients.reduce((n, c) => n + c.streamErrors, 0) - errBefore;
          const notReady = clients.reduce((n, c) => n + c.notReady, 0) - notReadyBefore;
          const bytesRead = clients.reduce((n, c) => n + c.bytesRead, 0) - bytesBefore;

          const assessment = assessStep({
            apiErrors,
            // The window's real sample count, not the requested one. A server
            // slow enough that a `/status/sessions` call outlasts the sampling
            // cadence yields fewer, and "most samples failed" has to be a
            // majority of what was taken rather than of what was asked for.
            sampleCount: agg.sampleCount,
            sessionsSeen,
            expectedSessions: clients.length,
            sessionsEverMatched,
            avgSpeed,
            streamOk,
            streamErrors,
            bytesRead,
            streamEverFlowed,
            windowMs: Date.now() - windowStart,
            dutyCycleMs: STRESS_PLAYLIST_POLL_MS,
          });

          return {
            apiErrors,
            sessionsSeen,
            windowMs: Date.now() - windowStart,
            streamOk,
            streamErrors,
            notReady,
            bytesRead,
            avgSpeed,
            avgBandwidth,
            totalKbps,
            actualKbps,
            assessment,
          };
        }

        ctx.log(`Step ${step}: Waiting ${Math.round(timings.stabiliseMs / 1000)}s for stabilisation...`);
        let m = await measureWindow(timings.stabiliseMs, "measure");
        if (ctx.signal.aborted) break;

        /**
         * Confirm before believing it.
         *
         * The ramp stops at the first bad window and that number is the
         * headline result, so a single unlucky window — a GC pause, a
         * competing stream, one slow segment — permanently understates the
         * server. Re-measuring the same session count costs one window and
         * turns "we saw one bad reading" into "it is still bad".
         *
         * The session count is deliberately unchanged: restarting the newest
         * session would measure a different thing, and a fresh session's
         * startup cost is exactly what the settle exists to exclude.
         */
        if (m.assessment.degraded && !ctx.signal.aborted) {
          ctx.log(`Step ${step}: possible degradation (${m.assessment.reason}) — re-measuring to confirm`);
          const retry = await measureWindow(timings.confirmSettleMs, "confirm");
          if (!ctx.signal.aborted) {
            if (retry.assessment.degraded) {
              m = retry;
            } else {
              ctx.log(`Step ${step}: did not reproduce — treating the first reading as transient`);
              m = { ...retry, assessment: { degraded: false, reason: null } };
              transientSteps++;
            }
          }
        }
        if (ctx.signal.aborted) break;

        const { apiErrors, sessionsSeen, streamOk, streamErrors, notReady, bytesRead, avgSpeed, avgBandwidth } = m;
        const { totalKbps, actualKbps } = m;
        const { degraded, reason } = m.assessment;

        if (streamOk > 0 || bytesRead > 0) streamEverFlowed = true;

        steps.push({
          step,
          sessions: clients.length,
          avgTranscodeSpeed: avgSpeed != null ? Math.round(avgSpeed * 100) / 100 : null,
          avgBandwidth: Math.round(avgBandwidth),
          errors: apiErrors,
          timestamp: Date.now(),
          sessionsSeen,
          streamErrors,
          reason,
          totalKbps: Math.round(totalKbps),
          actualKbps: Math.round(actualKbps),
          streamOk,
          notReady,
          bytesRead,
        });

        ctx.log(
          `Step ${step}: ${clients.length} session(s), seen=${sessionsSeen}, ` +
            `speed=${avgSpeed != null ? avgSpeed.toFixed(2) + "x" : "n/a"}, ` +
            `bandwidth=${Math.round(totalKbps)}kbps total / ${Math.round(actualKbps)}kbps actual, ` +
            `streams=${streamOk} ok / ${streamErrors} failed / ${notReady} not-ready, api errors=${apiErrors}`,
        );

        if (degraded) {
          // Say what the server said, not just how many times it said it.
          const failure = clients.reduce<string | null>((acc, c) => c.lastFailure ?? acc, null);
          const detail = failure && streamErrors > 0 ? `${reason} — last: ${failure}` : reason;
          const last = steps.at(-1);
          if (last) last.reason = detail;
          ctx.log(`Step ${step}: Degradation detected (${detail}) — stopping ramp-up`);
          break;
        }

        if (sessionsSeen >= clients.length) sessionsEverMatched = true;
        maxHealthySessions = clients.length;
      }
    } finally {
      // Runs on abort too: a cancelled run must leave the server exactly as it
      // found it, which is the whole reason the cleanup lives in a `finally`.
      //
      // The sampler keeps running through it. Sessions draining away is the one
      // part of the run whose *absence* is the reading, and a series that stops
      // at the last measurement leaves the chart showing full load at the moment
      // the run ended.
      setPhase("cleanup", maxSessions);
      ctx.log(`Cleaning up ${clients.length} session(s)...`);
      ctx.progress(maxSessions, maxSessions + 1, "Cleaning up sessions...");
      await Promise.allSettled(clients.map((c) => c.stop(client)));

      if (usedRatingKeys.size > 0) {
        ctx.log(`Marking ${usedRatingKeys.size} item(s) as unwatched...`);
        for (const key of usedRatingKeys) {
          try {
            await client.markUnwatched(key);
          } catch {
            // Best-effort cleanup.
          }
        }
      }

      clearInterval(sampleTimer);
      // One last reading with the sessions gone. Without it the series ends at
      // whatever the ticker happened to catch, which on a fast cleanup is full
      // load — the chart's final frame showing a saturated server at the moment
      // the run stopped.
      await takeSample().catch(() => {});
      // Anything still blocked in `collect` would otherwise never be woken.
      const stranded = waiters;
      waiters = [];
      for (const resolve of stranded) resolve();
    }

    const finishedAt = Date.now();
    const result: StressTestResult = {
      config,
      maxSessions: maxHealthySessions,
      steps,
      startedAt,
      finishedAt,
      telemetry: decimate(samples, STRESS_TELEMETRY_MAX_SAMPLES),
    };

    saveStressTestResult(resultId || randomUUID(), result);

    if (transientSteps > 0) {
      ctx.log(`${transientSteps} step(s) showed a bad reading that did not reproduce — the server is noisy`);
    }
    ctx.log(`Stress test complete: max supported sessions = ${maxHealthySessions}`);
    ctx.progress(1, 1, `Complete: ${maxHealthySessions} sessions supported`);

    return result;
  }

  /**
   * Persist the measurements.
   *
   * Deliberately does **not** set `status` on the update path. It used to write
   * `"completed"` unconditionally, which meant a cancelled run — whose cleanup
   * still reaches this line — overwrote the `cancelled` the API had just
   * recorded and was filed as a normal, complete result. The terminal status
   * belongs to the worker, which knows how the run actually ended.
   */
  function saveStressTestResult(id: string, result: StressTestResult): void {
    db.insert(stressTestRuns)
      .values({
        id,
        config: result.config,
        maxSessions: result.maxSessions,
        steps: result.steps,
        telemetry: result.telemetry,
        status: "completed",
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      })
      .onConflictDoUpdate({
        target: stressTestRuns.id,
        set: {
          config: result.config,
          maxSessions: result.maxSessions,
          steps: result.steps,
          telemetry: result.telemetry,
          finishedAt: result.finishedAt,
        },
      })
      .run();
  }

  /**
   * Stored configs are parsed leniently: a row written by an older version, or
   * one whose mode this build no longer knows, must not take out the whole
   * history listing.
   */
  function parseStoredConfig(raw: unknown): StressTestConfig {
    const parsed = stressTestConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : { mode: "mixed" };
  }

  function getStressTestRuns(): Array<{
    id: string;
    config: StressTestConfig;
    maxSessions: number | null;
    status: string;
    startedAt: number;
    finishedAt: number | null;
  }> {
    const rows = db
      .select({
        id: stressTestRuns.id,
        config: stressTestRuns.config,
        maxSessions: stressTestRuns.maxSessions,
        status: stressTestRuns.status,
        startedAt: stressTestRuns.startedAt,
        finishedAt: stressTestRuns.finishedAt,
      })
      .from(stressTestRuns)
      .orderBy(desc(stressTestRuns.startedAt))
      .all();

    return rows.map((r) => ({ ...r, config: parseStoredConfig(r.config) }));
  }

  function getStressTestRun(id: string): {
    id: string;
    config: StressTestConfig;
    maxSessions: number | null;
    steps: StressTestStep[];
    telemetry: StressTestSample[];
    status: string;
    message: string;
    log: string;
    progress: number;
    startedAt: number;
    finishedAt: number | null;
  } | null {
    const row = db.select().from(stressTestRuns).where(eq(stressTestRuns.id, id)).get();
    if (!row) return null;

    const steps = z.array(stressTestStepSchema).safeParse(row.steps);
    // Leniently, like the config and the steps: a series written by a build
    // whose sample shape differed must cost the reader its charts, not the page.
    const telemetry = z.array(stressTestSampleSchema).safeParse(row.telemetry);
    return {
      ...row,
      config: parseStoredConfig(row.config),
      steps: steps.success ? steps.data : [],
      telemetry: telemetry.success ? telemetry.data : [],
    };
  }

  function startStressTest(config: StressTestConfig): { id: string } {
    if (activeStressTest) {
      throw new Error(
        activeStressTest.exiting
          ? "The previous stress test is still shutting down"
          : "A stress test is already running",
      );
    }

    const id = randomUUID();
    const now = Date.now();

    const plexUrl = getConfig("global_plex_url");
    const plexToken = getConfig("global_plex_token");
    if (!plexUrl || !plexToken) {
      throw new Error("Plex URL and token are not configured");
    }

    db.insert(stressTestRuns)
      .values({
        id,
        config,
        maxSessions: null,
        steps: [],
        status: "running",
        progress: 0,
        message: "",
        log: "",
        startedAt: now,
      })
      .run();

    const child = fork(join(import.meta.dirname, "worker.ts"));
    const handle = { id, child, startedAt: now, exiting: false };
    activeStressTest = handle;

    function failRun(message: string): void {
      try {
        const row = db
          .select({ status: stressTestRuns.status })
          .from(stressTestRuns)
          .where(eq(stressTestRuns.id, id))
          .get();
        if (row?.status === "running") {
          db.update(stressTestRuns)
            .set({ status: "failed", message, finishedAt: Date.now() })
            .where(eq(stressTestRuns.id, id))
            .run();
        }
      } catch {
        // DB may be closed during shutdown.
      }
    }

    // Without this listener an EPIPE or a spawn failure emits `'error'` with
    // nothing attached, and Node rethrows it as an uncaught exception — taking
    // the API process down because a stress test failed to start.
    child.on("error", (err) => {
      log.error("stress test worker errored", { err: errorMessage(err), runId: id });
      failRun(`Worker process error: ${errorMessage(err)}`);
    });

    child.send({ id, config }, (err) => {
      if (!err) return;
      log.error("could not send config to stress test worker", { err: errorMessage(err), runId: id });
      failRun(`Could not start worker: ${errorMessage(err)}`);
    });

    child.on("exit", (code, signal) => {
      const uptime = Date.now() - handle.startedAt;
      // A worker that dies before it could plausibly have started is a wiring
      // failure, not a test result. Saying so is the difference between this
      // bug being found in a day and it surviving for three months behind
      // "exited unexpectedly".
      failRun(
        uptime < STRESS_WORKER_STARTUP_MS
          ? `Worker exited after ${uptime}ms without starting (code ${code}, signal ${signal}) — the worker entrypoint may not be wired up`
          : `Worker process exited unexpectedly (code ${code}, signal ${signal})`,
      );
      if (activeStressTest === handle) activeStressTest = null;
    });

    return { id };
  }

  function cancelStressTest(): void {
    if (!activeStressTest || activeStressTest.exiting) return;
    const handle = activeStressTest;
    handle.exiting = true;

    // The worker polls this and self-aborts, which is what lets it run its
    // cleanup rather than leaving sessions on the server.
    db.update(stressTestRuns)
      .set({ status: "cancelled", finishedAt: Date.now() })
      .where(eq(stressTestRuns.id, handle.id))
      .run();

    setTimeout(() => {
      if (handle.child.exitCode === null) handle.child.kill();
    }, STRESS_CANCEL_GRACE_MS).unref();
    // The handle stays until `exit` fires; see `activeStressTest`.
  }

  /**
   * The live run's state, and only the telemetry the caller has not seen.
   *
   * The log used to ride along with this on a two-second poll, and the whole
   * series would have done the same — a thousand samples re-serialised every
   * second for the length of a run that exists to load the machine. `sinceT` is
   * the same incremental contract `getJobRunLog` uses for logs; the log itself
   * has moved to `getStressTestRunLog` for that reason.
   *
   * `steps` rides along in full because there is one per session count — fifty
   * at the absolute cap — and the cockpit's capacity curve needs all of them.
   */
  function getActiveStressTest(sinceT = -1): {
    id: string;
    config: StressTestConfig;
    status: string;
    progress: number;
    message: string;
    startedAt: number;
    steps: StressTestStep[];
    samples: StressTestSample[];
    /** The `t` to pass back next poll. Unchanged when nothing new landed. */
    nextSinceT: number;
    /**
     * Total samples the run has recorded. A count *below* what the caller has
     * already accumulated means the series was thinned by `decimate` and its
     * points no longer line up — the caller must start over rather than splice
     * a coarse history onto a fine one.
     */
    total: number;
  } | null {
    if (!activeStressTest) return null;
    const row = db
      .select({
        id: stressTestRuns.id,
        config: stressTestRuns.config,
        status: stressTestRuns.status,
        progress: stressTestRuns.progress,
        message: stressTestRuns.message,
        startedAt: stressTestRuns.startedAt,
        steps: stressTestRuns.steps,
        telemetry: stressTestRuns.telemetry,
      })
      .from(stressTestRuns)
      .where(eq(stressTestRuns.id, activeStressTest.id))
      .get();
    if (!row) return null;

    const steps = z.array(stressTestStepSchema).safeParse(row.steps);
    const telemetry = z.array(stressTestSampleSchema).safeParse(row.telemetry);
    const all = telemetry.success ? telemetry.data : [];
    const samples = all.filter((sample) => sample.t > sinceT);

    return {
      id: row.id,
      config: parseStoredConfig(row.config),
      status: row.status,
      progress: row.progress,
      message: row.message,
      startedAt: row.startedAt,
      steps: steps.success ? steps.data : [],
      samples,
      nextSinceT: samples.at(-1)?.t ?? sinceT,
      total: all.length,
    };
  }

  /**
   * A slice of a run's log from `offset`, sliced by SQLite rather than shipped
   * whole. The same contract and the same codepoint caveat as `getJobRunLog`:
   * SQLite's `substr`/`length` count characters where JS counts UTF-16 code
   * units, so advancing by `chunk.length` would step past unread output.
   */
  function getStressTestRunLog(id: string, offset = 0): { chunk: string; nextOffset: number; size: number } | null {
    const from = Math.max(0, Math.floor(offset));
    const row = db
      .select({
        chunk: sql<string>`substr(${stressTestRuns.log}, ${from + 1})`,
        size: sql<number>`length(${stressTestRuns.log})`,
      })
      .from(stressTestRuns)
      .where(eq(stressTestRuns.id, id))
      .get();
    if (!row) return null;
    const chunk = row.chunk ?? "";
    return { chunk, nextOffset: from + [...chunk].length, size: row.size ?? 0 };
  }

  function markStaleStressTestsAsFailed(): void {
    const result = db
      .update(stressTestRuns)
      .set({ status: "failed", message: "Interrupted by a server restart", finishedAt: Date.now() })
      .where(eq(stressTestRuns.status, "running"))
      .run();
    if (result.changes > 0) {
      log.info("marked stale running stress test(s) as failed", { count: result.changes });
    }
  }

  return {
    runStressTest,
    saveStressTestResult,
    getStressTestRuns,
    getStressTestRun,
    startStressTest,
    cancelStressTest,
    getActiveStressTest,
    getStressTestRunLog,
    markStaleStressTestsAsFailed,
  };
});
