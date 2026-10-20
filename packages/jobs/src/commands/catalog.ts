/**
 * The single registry of runnable commands.
 *
 * Before this existed the same list was maintained by hand in three places —
 * `DEFAULT_JOBS` (runner.ts), `FEATURE_TEMPLATES` (features.ts), and
 * `VALID_COMMANDS` (sidequest/job.ts) — with nothing catching drift between
 * them. Everything now derives from `COMMANDS`, so adding a command is one
 * edit and a missing one is a typecheck error.
 *
 * `load()` is a static import thunk rather than the old
 * ``import(`../commands/${name}.ts`)`` template literal, which defeated static
 * analysis and would have broken under any future bundling step.
 *
 * NOTE: this file is distinct from `../sidequest/registry.ts`, which is
 * Sidequest's `manualJobResolution` entrypoint and must keep its one-line shape.
 */
import { HOUR_MS, MINUTE_MS, type JobContext } from "@tinkerbell/core";

/**
 * Which Sidequest queue a command runs on.
 *
 * - `interactive` — a human clicked a button and is watching for the result.
 * - `default` — scheduled batch work that may legitimately run for hours.
 *
 * The lanes have independent concurrency so a preroll upload doesn't queue
 * behind the nightly `generate`.
 */
export type CommandLane = "default" | "interactive";

export interface CommandDescriptor {
  load: () => Promise<{ default: (ctx: JobContext, config: never) => Promise<void> }>;
  lane: CommandLane;
  /**
   * Wall-clock budget. These are *runaway detectors*, not SLAs — a command
   * that legitimately takes longer than its budget should get a bigger budget,
   * not a faster implementation.
   */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30 * MINUTE_MS;

export const COMMANDS = {
  // ── Scheduled batch work ───────────────────────────────────────────────
  generate: { load: () => import("./generate.ts"), lane: "default", timeoutMs: 4 * HOUR_MS },
  // Same engine as `generate`, so the same generous budget: selection is the
  // expensive half and cleanup rules run the same handlers.
  cleanup: { load: () => import("./cleanup.ts"), lane: "default", timeoutMs: 4 * HOUR_MS },
  // Likewise: same engine, and one Plex read per matched item on top of it.
  metadata: { load: () => import("./metadata.ts"), lane: "default", timeoutMs: 4 * HOUR_MS },
  "sync-media": { load: () => import("./sync-media.ts"), lane: "default", timeoutMs: 2 * HOUR_MS },
  // One unpaged whole-library GET per instance, plus an incremental history
  // walk. Slow on a 10k library times four instances, but nowhere near
  // `sync-media`, which reads Plex twice for TV.
  "sync-arr": { load: () => import("./sync-arr.ts"), lane: "default", timeoutMs: HOUR_MS },
  // A handful of reads per instance. Five minutes means an instance is hung.
  "check-arr-quality": { load: () => import("./check-arr-quality.ts"), lane: "default", timeoutMs: 5 * MINUTE_MS },
  // Two requests per changed show. The first run on a large library touches
  // every show; after that it is the handful that changed.
  "scan-problems": { load: () => import("./scan-problems.ts"), lane: "default", timeoutMs: HOUR_MS },
  "sync-collections": { load: () => import("./sync-collections.ts"), lane: "default", timeoutMs: DEFAULT_TIMEOUT_MS },
  "sync-users": { load: () => import("./sync-users.ts"), lane: "default", timeoutMs: DEFAULT_TIMEOUT_MS },
  // Interactive: a human enables it from Settings and watches it fill in. A
  // long history walk is legitimately slow, hence the wider budget.
  "playback-backfill": {
    load: () => import("./playback-backfill.ts"),
    lane: "interactive",
    timeoutMs: HOUR_MS,
  },
  "posters-refresh": { load: () => import("./posters-refresh.ts"), lane: "default", timeoutMs: 2 * HOUR_MS },
  // Sized like `posters-refresh`, and for the same reason: a large library's
  // worth of image work, once, on a schedule. It renders a poster per
  // collection, which is why it is not inside the rule run.
  "collection-art": { load: () => import("./collection-art/index.ts"), lane: "default", timeoutMs: 2 * HOUR_MS },
  shuffle: { load: () => import("./shuffle.ts"), lane: "default", timeoutMs: DEFAULT_TIMEOUT_MS },
  "because-you-watched": {
    load: () => import("./because-you-watched.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // One model call per user per library, like BYW's per row, but far fewer of
  // them — so BYW's budget is ample.
  "we-think-youd-like": {
    load: () => import("./we-think-youd-like/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // Local queries and one episode list per stopped show — no model. The
  // default budget is far more than it needs.
  "pick-it-back-up": {
    load: () => import("./pick-it-back-up/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // A Plex walk per library and, the first time, TMDb details for every title
  // in it (30-day cache shared with the grouped rules). That first hydration of
  // a large library is the slow case the budget is sized for.
  "season-collections": {
    load: () => import("./season-collections/index.ts"),
    lane: "default",
    timeoutMs: HOUR_MS,
  },
  // Local queries, one TMDb details fetch per newly watched film and one
  // collection fetch per series in play. The default budget is ample.
  "finish-the-franchise": {
    load: () => import("./finish-the-franchise/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // Local queries only — no TMDb, no model.
  "watch-it-again": {
    load: () => import("./watch-it-again/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // Local queries and the recommender's ranking — no model.
  "new-for-you": {
    load: () => import("./new-for-you/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // A few paged Overseerr reads and local queries.
  "requests-arrived": {
    load: () => import("./requests-arrived/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // One read of the cleanup queue and an edit per library.
  "leaving-soon": {
    load: () => import("./leaving-soon/index.ts"),
    lane: "default",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // Local queries plus one network call per recipient. The default budget is
  // generous for that, and is really bounding a mail server that has stopped
  // answering rather than the work.
  digest: { load: () => import("./digest.ts"), lane: "default", timeoutMs: DEFAULT_TIMEOUT_MS },

  // ── Human-triggered, watched-in-the-UI ────────────────────────────────
  // ffmpeg on a large preroll is legitimately slow, hence the 6h budget.
  "preroll-process": { load: () => import("./preroll-process.ts"), lane: "interactive", timeoutMs: 6 * HOUR_MS },
  label: { load: () => import("./label.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  "label-undo": { load: () => import("./label-undo.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  // Someone clicked Undo and is watching. A batch can be thousands of writes,
  // hence the wider budget than its interactive neighbours.
  "metadata-undo": { load: () => import("./metadata-undo.ts"), lane: "interactive", timeoutMs: 2 * HOUR_MS },
  // Per-item overrides. Indexes a library per section before writing, so it
  // gets the same budget as the other metadata work rather than the default.
  "metadata-overrides": {
    load: () => import("./metadata-overrides.ts"),
    lane: "default",
    timeoutMs: 4 * HOUR_MS,
  },
  overlays: { load: () => import("./overlays.ts"), lane: "interactive", timeoutMs: 2 * HOUR_MS },
  "byw-remove": { load: () => import("./byw-remove.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  "wtyl-remove": { load: () => import("./wtyl-remove.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  "pibu-remove": { load: () => import("./pibu-remove.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  "season-remove": { load: () => import("./season-remove.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  "leaving-remove": { load: () => import("./leaving-remove.ts"), lane: "interactive", timeoutMs: DEFAULT_TIMEOUT_MS },
  "franchise-remove": {
    load: () => import("./franchise-remove.ts"),
    lane: "interactive",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  "requests-remove": {
    load: () => import("./requests-remove.ts"),
    lane: "interactive",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  "new-for-you-remove": {
    load: () => import("./new-for-you-remove.ts"),
    lane: "interactive",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  "watch-again-remove": {
    load: () => import("./watch-again-remove.ts"),
    lane: "interactive",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  // Both walk every item in the managed libraries. Batched labelling should
  // make that minutes, but a first pass on a large library or a slow server
  // took 30+ with one item per request, and the old 30-minute budget aborted
  // it — so the budget is sized for the slow case, not the hoped-for one.
  "personalize-enable": {
    load: () => import("./personalize-enable.ts"),
    lane: "interactive",
    timeoutMs: 2 * HOUR_MS,
  },
  "personalize-disable": {
    load: () => import("./personalize-disable.ts"),
    lane: "interactive",
    timeoutMs: 2 * HOUR_MS,
  },
  "migrate-collections": {
    load: () => import("./migrate-collections.ts"),
    lane: "interactive",
    timeoutMs: HOUR_MS,
  },
  // One metadata fetch per collection on the server, so the budget is sized
  // for a large library rather than the common case.
  "collections-sweep": {
    load: () => import("./collections-sweep.ts"),
    lane: "interactive",
    timeoutMs: HOUR_MS,
  },
} as const satisfies Record<string, CommandDescriptor>;

export type CommandName = keyof typeof COMMANDS;

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}
