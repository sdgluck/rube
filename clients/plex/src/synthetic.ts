/**
 * Tinkerbell's own simulated playback, and how everything else knows to ignore it.
 *
 * The stress harness starts *real* Plex sessions — a real transcode, real
 * segment fetches, real timeline reports — because anything less would measure
 * nothing anyone cares about. The consequence is that from `/status/sessions`
 * they are indistinguishable from someone watching a film, and every feature
 * that reads that endpoint was recording them: twenty fake streams landing in
 * playback history as twenty plays, a bandwidth series with a 200 Mbps spike
 * nobody caused, a dashboard reporting the load the *measurement* was making.
 *
 * The marker is the client identifier the harness gives each simulated player,
 * which it already needed in order to find its own sessions among everyone
 * else's. This module is where that prefix is defined and where the check lives,
 * for two reasons: it sits below every consumer — `domains/playback`,
 * `domains/bandwidth`, the tRPC routers and `packages/jobs` all reach it,
 * whereas the harness's own package is above most of them — and a predicate
 * that has to be spelled out at each call site is one that gets forgotten at
 * the next.
 *
 * Anything that reads sessions for *reporting* must exclude these. The stress
 * harness itself is the one caller that wants the opposite, and asks for it by
 * name.
 */

import type { PlexSession } from "./types.ts";

/**
 * The client-identifier prefix Tinkerbell stamps on every session it fabricates.
 *
 * A reserved namespace, not a guess: a real Plex client's identifier is a UUID
 * or a vendor string, so nothing a person is actually watching on can collide
 * with it.
 */
export const SYNTHETIC_CLIENT_PREFIX = "tinkerbell-stress-";

/** Deliberately structural, so a caller with a narrower row can still ask. */
export interface HasPlayerMachineId {
  playerMachineId?: string;
}

export function isSyntheticSession(session: HasPlayerMachineId): boolean {
  return session.playerMachineId?.startsWith(SYNTHETIC_CLIENT_PREFIX) ?? false;
}

/** Everything a person is actually watching. */
export function realSessions<T extends HasPlayerMachineId>(sessions: readonly T[]): T[] {
  return sessions.filter((session) => !isSyntheticSession(session));
}

/** The harness finding its own. The inverse of `realSessions`, named so the
 *  one caller that wants synthetic sessions says so. */
export function syntheticSessions<T extends HasPlayerMachineId>(sessions: readonly T[]): T[] {
  return sessions.filter(isSyntheticSession);
}

export type { PlexSession };
