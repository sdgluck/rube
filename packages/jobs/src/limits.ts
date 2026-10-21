/**
 * Tunable timing/size constants for the job runner. Centralised so they're
 * named in one place and obvious to find when tuning.
 */

import { MINUTE_MS, WEEK_MS } from "@rube/core";

/** How long finished job runs are kept before `purge-runs` deletes them. */
export const JOB_RUN_RETENTION_MS = WEEK_MS;

/** Per-job hard cap on retained runs in `jobRuns`. The purge-runs cron handles
 * age-based cleanup; this cap handles high-frequency jobs that would otherwise
 * accumulate thousands of rows between purges. */
export const JOB_RUN_KEEP_PER_JOB = 50;

/** Default `limit` injected into job configs that page over their data — UI
 * typically overrides this from settings. */
export const DEFAULT_JOB_RUN_LIMIT = 10;

/** Sidequest job runner: how often the per-run log/progress buffer is
 * flushed to SQLite. Lower = livelier UI; higher = fewer writes. */
export const JOB_LOG_FLUSH_INTERVAL_MS = 500;

/** How often the runner polls `jobRuns.status` to detect a "cancelling"
 * mutation from the API and abort the in-flight command. */
export const JOB_CANCEL_POLL_INTERVAL_MS = 1000;

/**
 * Grace period added on top of a command's budget before the run is force-failed.
 *
 * Aborting `ctx.signal` asks the command to unwind; a well-behaved one does so
 * quickly. This is how long we wait for that before declaring the worker wedged
 * and failing the run so the queue and the UI recover.
 */
export const JOB_TIMEOUT_GRACE_MS = MINUTE_MS;

/** How often the main process sweeps `job_runs` for runs past their deadline. */
export const JOB_WATCHDOG_INTERVAL_MS = MINUTE_MS;

/**
 * How long a run may sit in `cancelling` before the watchdog force-fails it.
 * A command that hasn't unwound within this window is not going to.
 */
export const JOB_CANCELLING_GRACE_MS = 2 * MINUTE_MS;

/**
 * Hard cap on a single run's stored log. Past this we stop appending and keep
 * only a bounded tail (flushed when the run ends), because the failure tail is
 * the part anyone actually reads.
 *
 * Counted with each line's time (`stampLog`), ~25 bytes a line: at the
 * typical 60–100-byte line that is a quarter fewer lines before the cap, which
 * still holds tens of thousands. Raise it if real runs start reaching it.
 */
export const JOB_LOG_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes of trailing log retained after the cap is hit. */
export const JOB_LOG_TAIL_BYTES = 64 * 1024;

/** Checkpoints older than this are ignored on read, so stale state can never silently skip work. */
export const CHECKPOINT_TTL_MS = 24 * 60 * MINUTE_MS;

// ─── Stress test ─────────────────────────────────────────────────────────────
// The harness ramps one simulated playback session at a time and decides, after
// each one, whether the server is still keeping up. Every number below is part
// of that judgement, so they live here rather than as literals in the ramp.

/**
 * How long a newly-started session is given before it is measured.
 *
 * A Plex transcoder reports `speed=0` for the first several seconds while it
 * fills its buffer, and a session doesn't appear in `/status/sessions` until
 * the first timeline report lands. Measuring inside that window reads startup
 * latency as saturation and stops the ramp one session in.
 */
export const STRESS_STABILISE_MS = 15_000;

/** Sessions a run ramps to when the caller doesn't say. */
export const STRESS_DEFAULT_SESSIONS = 20;

/**
 * Hard cap on the session count a run may be asked for.
 *
 * Each session is a real transcode on someone's server and a real stream off
 * it, so an unbounded number here is a denial-of-service against the user's own
 * Plex. The UI has always offered 1–50; this is the same bound enforced where
 * it can't be bypassed.
 */
export const STRESS_MAX_SESSIONS = 50;

/** How many times each step samples `/status/sessions`. Odd, so "most samples
 * failed" is unambiguous. */
export const STRESS_SAMPLE_COUNT = 3;

/** Gap between samples within a step. */
export const STRESS_SAMPLE_INTERVAL_MS = 2_000;

/**
 * Settle time before the *confirmation* window that re-measures a bad step.
 *
 * Shorter than the first settle: the sessions are already running, so this is
 * only a gap between two readings rather than a warm-up. Long enough that the
 * two windows cannot share one transient.
 */
export const STRESS_CONFIRM_SETTLE_MS = 5_000;

/**
 * Transcode speed below which the server is judged to be falling behind.
 *
 * 1.0x is realtime: the transcoder is producing exactly one second of video per
 * second of wall clock. Below that the buffer drains and a real viewer buffers,
 * so it is the honest threshold rather than a tuned one.
 */
export const STRESS_MIN_TRANSCODE_SPEED = 1.0;

/**
 * Media pool size, as a multiple of the session cap.
 *
 * Sessions reuse keys by modulo, so the pool only has to be big enough that
 * concurrent sessions rarely share an item — two per session is plenty, and
 * keeping it bounded matters because every candidate costs a metadata fetch.
 */
export const STRESS_POOL_FACTOR = 2;

/** Assumed runtime when an item reports no duration, for timeline reports.
 * Only ever used to make the fake player look plausible to Plex. */
export const STRESS_FALLBACK_DURATION_MS = 2 * 60 * 60 * 1000;

/** How often a simulated client reports its timeline, and how far playback
 * advances each time. Plex expires a session that stops reporting. */
export const STRESS_TIMELINE_INTERVAL_MS = 10_000;

/** How often the HLS loop re-reads the live media playlist. Segments are
 * typically 4–6s, so polling faster only burns requests. */
export const STRESS_PLAYLIST_POLL_MS = 4_000;

/** Direct play: how long each read burst runs, and the gap between bursts. */
export const STRESS_DIRECT_READ_MS = 5_000;
export const STRESS_DIRECT_GAP_MS = 2_000;

/**
 * How many segments a client consumes per playlist poll.
 *
 * This is playback pacing, and it is not optional. Plex's transcode playlist
 * lists the *whole* file, not a sliding window, so a client that fetches every
 * segment it has not seen yet races the transcoder at whatever speed the link
 * allows — measured at ~226 requests/second against a real server, of which 95%
 * were 404s for segments that did not exist yet. That is a bandwidth test with
 * a hot loop attached, not a playback simulation.
 *
 * Two segments per 4s poll is a little ahead of realtime for the usual 5s
 * segment, which is what a real player buffering slightly ahead looks like.
 */
export const STRESS_SEGMENTS_PER_POLL = 2;

/** How long `cancelStressTest` waits for the worker to unwind on its own
 * before killing the child. */
export const STRESS_CANCEL_GRACE_MS = 5_000;

/**
 * A child that exits sooner than this without reporting progress is treated as
 * a wiring failure rather than a test result. The worker is a process
 * entrypoint: if its bootstrap is missing, Node unrefs the IPC channel and the
 * child exits in tens of milliseconds — which is exactly how this feature
 * stayed broken for three months behind a generic "exited unexpectedly".
 */
export const STRESS_WORKER_STARTUP_MS = 2_000;

/**
 * Samples retained on a run's telemetry series.
 *
 * The series is rewritten into a JSON column twice a second for the life of the
 * run, so its size is a cost paid continuously rather than once. At the 2s
 * sampling cadence this is a little over forty minutes at full resolution; past
 * that `decimate` halves the older half rather than dropping the tail, so a
 * longer run keeps its whole shape at a coarser grain. Roughly 150 bytes a
 * sample with a handful of sessions attached, so ~180KB at the cap.
 */
export const STRESS_TELEMETRY_MAX_SAMPLES = 1200;
