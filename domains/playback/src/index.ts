/**
 * Rube's own watch record.
 *
 * Plex answers "what is playing right now" (`/status/sessions`) and "who viewed
 * what, when" (`/status/sessions/history/all`). It does not answer "how much of
 * it did they actually watch", "did everyone finish this", or "what was the
 * transcode decision" — and those are the questions collections, cleanup rules
 * and digests are built on. So we sample the live session and keep the log.
 *
 * Three layers, kept in separate files because only the first needs to be
 * exhaustively tested and none of it needs a Plex to test:
 *
 *   diff.ts     the state machine, pure — snapshots in, writes out
 *   store.ts    persistence and queries over playback_sessions / watch_state
 *   poller.ts   the 30-second tick that feeds the state machine
 *   backfill.ts one-shot import of Plex's own view log, so a fresh install
 *               isn't blind for the weeks it takes the poller to accumulate
 *   evaluate.ts the `tb.` smart-filter predicates, pure — the questions Plex
 *               cannot answer because it only ever sees one token's view state
 *
 * `diff.ts` and `evaluate.ts` are pure and stay plain module exports; the three
 * that touch the database or Plex are factories, composed here.
 */
import { token } from "@rube/container";
import type { Db } from "@rube/db";
import type { Clients, ConfigStore } from "@rube/core";
import type { Bandwidth } from "@rube/domain.bandwidth";
import { createStore } from "./store.ts";
import { createPoller } from "./poller.ts";
import { createBackfill } from "./backfill.ts";

export * from "./diff.ts";
export * from "./evaluate.ts";
export {
  HISTORY_SORTS,
  type HistorySort,
  type PlaybackBreakdown,
  type PlaybackRow,
  type TopPlayedRank,
  type TopUserRow,
  type WatchedByRow,
  type WatchHistoryCoverage,
  type WatchStateRow,
  type WatchStateUserScope,
  type WatchSummary,
} from "./store.ts";

export interface PlaybackDeps {
  db: Db;
  config: ConfigStore;
  clients: Clients;
  bandwidth: Bandwidth;
}

export function createPlayback(deps: PlaybackDeps) {
  return {
    ...createStore(deps),
    ...createPoller(deps),
    ...createBackfill(deps),
  };
}

export type Playback = ReturnType<typeof createPlayback>;

export const PlaybackToken = token<Playback>("playback");
