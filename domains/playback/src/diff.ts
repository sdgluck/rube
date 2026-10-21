/**
 * The playback state machine, as a pure function.
 *
 * Everything that can be wrong about watch history is in this file: whether a
 * seek inflates watch time, whether a pause accrues it, whether a reused
 * session key merges two unrelated plays, whether stopping at 84% counts as
 * watched. None of that needs a database or a Plex server to get wrong, so
 * none of it needs one to test — `diffSnapshot` takes the currently-open
 * sessions and one `/status/sessions` sample and returns the writes to make.
 *
 * `recordPollSnapshot` in `index.ts` is the thin persistence wrapper.
 */
import type { PlexSession } from "@rube/plex";

/** A session the poller currently believes is open. */
export interface OpenSession {
  id: string;
  plexSessionKey: string;
  userId: number;
  ratingKey: string;
  startedAt: number;
  lastSeenAt: number;
  durationMs: number;
  watchedMs: number;
  viewOffsetMs: number;
  state: string;
}

export interface NewSession {
  plexSessionKey: string;
  userId: number;
  username: string;
  ratingKey: string;
  grandparentRatingKey: string | null;
  sectionId: string;
  title: string;
  grandparentTitle: string | null;
  type: string;
  player: string;
  platform: string;
  decision: string;
  local: number;
  startedAt: number;
  lastSeenAt: number;
  durationMs: number;
  watchedMs: number;
  viewOffsetMs: number;
  completionPct: number;
  state: string;
}

export interface SessionUpdate {
  id: string;
  lastSeenAt: number;
  watchedMs: number;
  viewOffsetMs: number;
  durationMs: number;
  completionPct: number;
  state: string;
}

export interface SessionClose {
  id: string;
  endedAt: number;
  watchedMs: number;
  viewOffsetMs: number;
  completionPct: number;
  /** completed | abandoned | stale */
  state: string;
}

export interface SnapshotDiff {
  opens: NewSession[];
  updates: SessionUpdate[];
  closes: SessionClose[];
}

export interface DiffOptions {
  /**
   * Fraction of duration past which a play counts as watched. This is what
   * "watched" means for every downstream consumer — cleanup rules, watched-by-all
   * filters, digests — so it lives in config rather than as a constant here.
   */
  completionThreshold: number;
  /**
   * Interval the poller runs at. A forward jump larger than a small multiple of
   * this is a seek, not playback, and must not be credited as watch time.
   */
  intervalMs: number;
}

/**
 * Identity of a *play*, not of a Plex session.
 *
 * Plex hands out `sessionKey` values that it reuses freely — the same key can
 * belong to a different film an hour later. Keying on the key alone would
 * extend the old row instead of opening a new one, silently welding two plays
 * into a single record with a nonsense duration. Including the rating key and
 * the user makes a reused key open a fresh row, which is the honest reading.
 *
 * NUL separates the parts because it cannot occur in any of them, so no
 * combination of values can collide by straddling the separator. It is written
 * as an escape rather than a literal — see `scripts/check-nul.mjs`.
 */
export function playKey(sessionKey: string, ratingKey: string, userId: number): string {
  return `${sessionKey}\u0000${ratingKey}\u0000${userId}`;
}

/**
 * How much of the observed offset delta to credit as time actually watched.
 *
 * Three cases, and only the first is real playback:
 *   • 0 < delta ≤ interval × SEEK_FACTOR — normal progress, credit it.
 *   • delta ≤ 0 — paused (identical offset) or seeked backwards. Credit nothing.
 *     Never subtract: rewinding and rewatching is still watching.
 *   • delta > interval × SEEK_FACTOR — a forward seek. Credit only what could
 *     plausibly have been played in the elapsed wall-clock time, so skipping
 *     40 minutes of a film doesn't record 40 minutes of viewing.
 *
 * The factor is deliberately loose: a tick that arrives late (a slow Plex, a
 * busy host) legitimately shows more progress than the nominal interval, and
 * treating that as a seek would under-count every session on a loaded server.
 */
const SEEK_FACTOR = 3;

function creditedProgress(
  previousOffset: number,
  currentOffset: number,
  elapsedMs: number,
  intervalMs: number,
): number {
  const delta = currentOffset - previousOffset;
  if (delta <= 0) return 0;
  const ceiling = Math.max(intervalMs, elapsedMs) * SEEK_FACTOR;
  return delta > ceiling ? Math.max(0, elapsedMs) : delta;
}

function completion(viewOffsetMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, viewOffsetMs / durationMs));
}

/** Terminal state for a session that has disappeared from `/status/sessions`. */
function closedState(completionPct: number, threshold: number): string {
  return completionPct >= threshold ? "completed" : "abandoned";
}

/**
 * Diff one `/status/sessions` sample against the currently-open sessions.
 *
 * Pure: no clock, no DB, no network. `now` and the open set are inputs so a
 * whole viewing session can be replayed as a list of snapshots in a test.
 */
export function diffSnapshot(
  open: OpenSession[],
  sessions: PlexSession[],
  now: number,
  opts: DiffOptions,
): SnapshotDiff {
  const openByKey = new Map(open.map((s) => [playKey(s.plexSessionKey, s.ratingKey, s.userId), s]));
  const seen = new Set<string>();

  const opens: NewSession[] = [];
  const updates: SessionUpdate[] = [];
  const closes: SessionClose[] = [];

  for (const session of sessions) {
    const ratingKey = session.ratingKey;
    // A session with no rating key isn't a play we can attribute to an item;
    // Plex occasionally emits these for live TV and pre-roll content.
    if (!ratingKey) continue;

    const userId = session.userId ?? 0;
    const sessionKey = session.sessionKey ?? "";
    const key = playKey(sessionKey, ratingKey, userId);
    seen.add(key);

    const durationMs = session.duration ?? 0;
    const viewOffsetMs = session.viewOffset ?? 0;
    // Plex reports `paused` on the player; anything else while the session is
    // present is playing. The distinction only affects the stored state — watch
    // time is derived from offset movement, so a pause accrues nothing either way.
    const playerState = session.state === "paused" ? "paused" : "playing";

    const existing = openByKey.get(key);
    if (!existing) {
      opens.push({
        plexSessionKey: sessionKey,
        userId,
        username: session.user,
        ratingKey,
        grandparentRatingKey: session.grandparentRatingKey ?? null,
        sectionId: session.librarySectionId ?? "",
        title: session.title,
        grandparentTitle: session.grandparentTitle ?? null,
        type: session.type,
        player: session.player,
        platform: session.platform ?? "",
        decision: session.decision,
        local: session.local ? 1 : 0,
        startedAt: now,
        lastSeenAt: now,
        durationMs,
        // First sighting credits nothing: we have no previous offset to measure
        // against, and crediting the current offset would hand a full film's
        // watch time to a session we joined at the 90-minute mark.
        watchedMs: 0,
        viewOffsetMs,
        completionPct: completion(viewOffsetMs, durationMs),
        state: playerState,
      });
      continue;
    }

    const elapsedMs = now - existing.lastSeenAt;
    const credited = creditedProgress(existing.viewOffsetMs, viewOffsetMs, elapsedMs, opts.intervalMs);
    updates.push({
      id: existing.id,
      lastSeenAt: now,
      watchedMs: existing.watchedMs + credited,
      viewOffsetMs,
      // Duration can arrive late (a transcode starting up reports 0 first).
      durationMs: durationMs || existing.durationMs,
      completionPct: completion(viewOffsetMs, durationMs || existing.durationMs),
      state: playerState,
    });
  }

  for (const session of open) {
    const key = playKey(session.plexSessionKey, session.ratingKey, session.userId);
    if (seen.has(key)) continue;
    const completionPct = completion(session.viewOffsetMs, session.durationMs);
    closes.push({
      id: session.id,
      endedAt: now,
      watchedMs: session.watchedMs,
      viewOffsetMs: session.viewOffsetMs,
      completionPct,
      state: closedState(completionPct, opts.completionThreshold),
    });
  }

  return { opens, updates, closes };
}

/**
 * Close sessions the poller lost track of — the process restarted mid-film, or
 * Plex went away long enough that we can no longer say what happened.
 *
 * These are marked `stale`, never `completed`. We genuinely do not know whether
 * the user finished it, and guessing in the generous direction would let a
 * restart mark a library as watched. Downstream, `stale` counts as a play but
 * not a completed one.
 */
export function staleCloses(open: OpenSession[], now: number, cutoffMs: number): SessionClose[] {
  return open
    .filter((s) => now - s.lastSeenAt > cutoffMs)
    .map((s) => ({
      id: s.id,
      endedAt: s.lastSeenAt,
      watchedMs: s.watchedMs,
      viewOffsetMs: s.viewOffsetMs,
      completionPct: completion(s.viewOffsetMs, s.durationMs),
      state: "stale",
    }));
}
