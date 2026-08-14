/**
 * Tinkerbell's own watch record.
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
 *   diff.ts    the state machine, pure — snapshots in, writes out
 *   store.ts   persistence and queries over playback_sessions / watch_state
 *   poller.ts  the 30-second tick that feeds the state machine
 */
export * from "./diff.ts";
export * from "./store.ts";
export * from "./poller.ts";
