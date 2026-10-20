/**
 * What the schedule editor needs to know about each job that no other table
 * already says.
 *
 * Lane and timeout are deliberately absent: they live in the jobs package's
 * `COMMANDS` and internal-job descriptors, and the server sends them along with
 * the schedule context rather than this file keeping a second copy to drift.
 * Whether a schedule is editable at all comes from `JOB_PRESENTATION`. What is
 * left is the knowledge that used to exist only as comments above
 * `DEFAULT_JOBS` — "4am: after sync-media … after generate … clear of
 * purge-runs" — which nothing could check, and which the shipped defaults had
 * quietly stopped honouring once onboarding started recommending a 01:00–06:00
 * maintenance window that held the midnight syncs back onto `generate`.
 *
 * `packages/jobs/src/schedule-meta.test.ts` fails on an id here that no job
 * has, on a job missing from here, and on an ordering cycle.
 */
import { isAlwaysOnJob } from "./always-on-jobs.ts";
import { jobPresentation } from "./job-presentation.ts";
import { MINUTE_MS } from "./job-schedule.ts";

/** Something a job needs configured before it does anything useful. */
export type ScheduleService = "seerr" | "arr" | "personalizedSharing" | "watchlist" | "notifier" | "backups";

export type ScheduleCapabilities = Record<ScheduleService, boolean>;

export const SCHEDULE_SERVICE_LABELS: Record<ScheduleService, string> = {
  seerr: "Overseerr",
  arr: "Radarr or Sonarr",
  personalizedSharing: "Personalized Home Screens",
  watchlist: "Watchlist sync",
  notifier: "a notification channel",
  backups: "Backups",
};

export interface JobScheduleMeta {
  /**
   * Walks the whole library, renders or transcodes. Held back by the
   * maintenance window and defer-while-streaming, and refused a schedule that
   * fires more often than its own timeout.
   */
  heavy?: boolean;
  /**
   * What breaks if it never runs. `error`: the install degrades (tables grow
   * without bound, rule schedules stop). `warning`: a feature goes stale.
   */
  essential?: "error" | "warning";
  /** Its cadence is part of how something else works; shown, never moved. */
  pinned?: boolean;
  /** May fire more than once a minute. */
  allowSeconds?: boolean;
  requires?: ScheduleService;
  /**
   * Returns in microseconds when `requires` isn't configured, and starts
   * working by itself the moment it is. Not worth a warning, and a preset
   * must not turn it off — that would be a trap for the day Overseerr is added.
   */
  noopWithoutService?: boolean;
  /** Block width on the timeline before there are runs to measure. */
  estimateMs: number;
}

const DEFAULT_META: JobScheduleMeta = { estimateMs: MINUTE_MS };

export const JOB_SCHEDULE_META: Record<string, JobScheduleMeta> = {
  "sync-media": { heavy: true, essential: "warning", estimateMs: 20 * MINUTE_MS },
  "sync-collections": { heavy: true, essential: "warning", estimateMs: 5 * MINUTE_MS },
  "sync-arr": { requires: "arr", noopWithoutService: true, estimateMs: 5 * MINUTE_MS },
  // A few reads per instance with a managed profile, and nothing at all without one.
  "check-arr-quality": { requires: "arr", noopWithoutService: true, estimateMs: MINUTE_MS },
  // Not `requires: "arr"`: the rule and library checks run without one.
  "scan-problems": { estimateMs: 5 * MINUTE_MS },
  generate: { heavy: true, essential: "warning", estimateMs: 30 * MINUTE_MS },
  cleanup: { heavy: true, estimateMs: 15 * MINUTE_MS },
  metadata: { heavy: true, estimateMs: 15 * MINUTE_MS },
  "metadata-overrides": { estimateMs: 5 * MINUTE_MS },
  "purge-runs": { essential: "error", estimateMs: MINUTE_MS },
  backup: { requires: "backups", noopWithoutService: true, estimateMs: MINUTE_MS },
  "sync-recently-added": { essential: "warning", estimateMs: MINUTE_MS },
  "sync-users": { essential: "warning", estimateMs: 2 * MINUTE_MS },
  "seerr-poll": { requires: "seerr", noopWithoutService: true, estimateMs: MINUTE_MS },
  "arr-poll": { requires: "arr", noopWithoutService: true, estimateMs: MINUTE_MS },
  "quality-swaps": { requires: "arr", noopWithoutService: true, estimateMs: MINUTE_MS },
  "watchlist-sync": { requires: "watchlist", noopWithoutService: true, estimateMs: MINUTE_MS },
  // The clock for every rule's own cron — moving it moves all of them.
  "rule-schedules": { essential: "error", pinned: true, estimateMs: MINUTE_MS },
  healthcheck: { essential: "warning", estimateMs: MINUTE_MS },
  "playback-poll": { essential: "warning", allowSeconds: true, estimateMs: MINUTE_MS },
  "bandwidth-test": { estimateMs: MINUTE_MS },
  "collections-sweep": { estimateMs: 5 * MINUTE_MS },
  "registry-updates": { estimateMs: MINUTE_MS },
  "posters-refresh": { heavy: true, estimateMs: 30 * MINUTE_MS },
  "collection-art": { heavy: true, estimateMs: 15 * MINUTE_MS },
  "playback-backfill": { estimateMs: 10 * MINUTE_MS },
  "because-you-watched": { heavy: true, requires: "personalizedSharing", estimateMs: 10 * MINUTE_MS },
  "we-think-youd-like": { heavy: true, requires: "personalizedSharing", estimateMs: 10 * MINUTE_MS },
  "pick-it-back-up": { requires: "personalizedSharing", estimateMs: 5 * MINUTE_MS },
  // No `requires`: its default mode is one shared row and needs no
  // personalization. Per-person mode's need is the readiness check's to state.
  "season-collections": { estimateMs: 5 * MINUTE_MS },
  "finish-the-franchise": { requires: "personalizedSharing", estimateMs: 5 * MINUTE_MS },
  "requests-arrived": { requires: "personalizedSharing", estimateMs: 2 * MINUTE_MS },
  "watch-it-again": { requires: "personalizedSharing", estimateMs: 2 * MINUTE_MS },
  "leaving-soon": { estimateMs: 2 * MINUTE_MS },
  shuffle: { estimateMs: 2 * MINUTE_MS },
  overlays: { heavy: true, estimateMs: 30 * MINUTE_MS },
  digest: { requires: "notifier", estimateMs: 2 * MINUTE_MS },
  // One-shot actions driven from other pages. Listed so the drift test can
  // tell "known, not schedulable" from "forgotten".
  "preroll-process": { heavy: true, estimateMs: 10 * MINUTE_MS },
  label: { estimateMs: 10 * MINUTE_MS },
  "label-undo": { estimateMs: 10 * MINUTE_MS },
  "metadata-undo": { estimateMs: 10 * MINUTE_MS },
  "byw-remove": { estimateMs: 5 * MINUTE_MS },
  "wtyl-remove": { estimateMs: 5 * MINUTE_MS },
  "pibu-remove": { estimateMs: 5 * MINUTE_MS },
  "season-remove": { estimateMs: 5 * MINUTE_MS },
  "franchise-remove": { estimateMs: 5 * MINUTE_MS },
  "requests-remove": { estimateMs: 5 * MINUTE_MS },
  "watch-again-remove": { estimateMs: 5 * MINUTE_MS },
  "leaving-remove": { estimateMs: 5 * MINUTE_MS },
  "personalize-enable": { estimateMs: 30 * MINUTE_MS },
  "personalize-disable": { estimateMs: 30 * MINUTE_MS },
  "overlays-remove": { estimateMs: 30 * MINUTE_MS },
  "migrate-collections": { estimateMs: 10 * MINUTE_MS },
};

export function jobScheduleMeta(jobId: string): JobScheduleMeta {
  return JOB_SCHEDULE_META[jobId] ?? DEFAULT_META;
}

/**
 * The jobs the maintenance window and defer-while-streaming hold back. The
 * scheduler's deferral gate reads this list, so "heavy" on the timeline and
 * "held back" at 20:00 cannot disagree.
 */
export const HEAVY_JOB_IDS: readonly string[] = Object.entries(JOB_SCHEDULE_META)
  .filter(([, meta]) => meta.heavy)
  .map(([id]) => id);

/** Whether a schedule means anything for this job. */
export function isSchedulableJob(jobId: string): boolean {
  const presentation = jobPresentation(jobId);
  return presentation.kind !== "hidden" && presentation.schedule === "editable";
}

/** Can be moved, but not switched off. */
export function canDisableJob(jobId: string): boolean {
  return !isAlwaysOnJob(jobId);
}

export interface JobOrderEdge {
  before: string;
  after: string;
  /** Shown in the warning when the edge is broken. */
  reason: string;
}

/**
 * "X should have finished before Y starts", for jobs whose output another
 * job reads. Only edges with a concrete reason — two jobs that merely tend to
 * run near each other are a lane question, not an ordering one.
 */
export const JOB_ORDER: readonly JobOrderEdge[] = [
  { before: "sync-media", after: "sync-arr", reason: "it links Radarr and Sonarr records using ids Sync Media writes" },
  {
    before: "sync-arr",
    after: "scan-problems",
    reason: "it compares the Sonarr series Sync Radarr & Sonarr links to Plex shows",
  },
  { before: "sync-media", after: "generate", reason: "rules select from the library index Sync Media refreshes" },
  {
    before: "sync-collections",
    after: "generate",
    reason: "it reconciles against the collections Sync Collections mirrors",
  },
  { before: "sync-media", after: "metadata", reason: "metadata rules select from the library index" },
  {
    before: "metadata",
    after: "metadata-overrides",
    reason: "per-item edits are meant to win over rule-written metadata",
  },
  {
    before: "sync-media",
    after: "cleanup",
    reason: "cleanup's safety checks read the library index, and stale data is how the wrong thing gets deleted",
  },
  { before: "generate", after: "cleanup", reason: "a cleanup rule's shelf should reflect the night's collections" },
  {
    before: "generate",
    after: "collection-art",
    reason: "it finds a rule's collections by label after they are built",
  },
  {
    before: "purge-runs",
    after: "backup",
    reason: "the backup should be of a database that has already shed expired rows",
  },
  { before: "backup", after: "cleanup", reason: "the backup worth having is the one taken before anything is deleted" },
  {
    before: "sync-media",
    after: "we-think-youd-like",
    reason: "a taste profile reads genres and ratings from the library index",
  },
  {
    before: "sync-media",
    after: "pick-it-back-up",
    reason: "it finds each show's library and title in the library index",
  },
  {
    before: "sync-media",
    after: "season-collections",
    reason: "it ranks matches by the ratings and genres in the library index",
  },
  {
    before: "sync-media",
    after: "finish-the-franchise",
    reason: "it finds each film's TMDb id and library in the library index",
  },
  {
    before: "sync-media",
    after: "requests-arrived",
    reason: "it finds where each arrival is in the library index",
  },
  {
    before: "sync-media",
    after: "watch-it-again",
    reason: "it finds each film's library, rating and TMDb id in the library index",
  },
  {
    before: "cleanup",
    after: "leaving-soon",
    reason: "it shows what the last cleanup run left queued, and drops what that run removed",
  },
];

/**
 * The scheduling settings onboarding's "Use recommended" writes, and the
 * Recommended preset applies. One constant so the two can't recommend
 * different windows — which is how the shipped midnight syncs came to sit
 * outside the window the setup flow told everybody to use.
 */
export const RECOMMENDED_SCHEDULE_SETTINGS = {
  maintenanceWindow: { enabled: true, from: "01:00", to: "06:00" },
  deferWhileStreaming: { enabled: true, maxWaitMinutes: 120, transcodesOnly: false },
} as const;
