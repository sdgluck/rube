/**
 * A schedule context shaped like a fresh install, for the tests in this
 * package. The jobs package's own test builds the real one from `DEFAULT_JOBS`
 * and `COMMANDS` and checks the shipped defaults against the same rules —
 * this copy only has to be representative, not authoritative.
 */
import { isAlwaysOnJob } from "./always-on-jobs.ts";
import type { ScheduleCapabilities } from "./job-schedule-meta.ts";
import { HOUR_MS, MINUTE_MS } from "./job-schedule.ts";
import type { ScheduleContext, ScheduleJob, ScheduleLane } from "./job-schedule-validate.ts";

const ROWS: Array<[id: string, lane: ScheduleLane, timeoutMs: number, schedule: string]> = [
  ["sync-media", "default", 2 * HOUR_MS, "0 0 * * *"],
  ["sync-collections", "default", 30 * MINUTE_MS, "0 0 * * *"],
  ["sync-arr", "default", HOUR_MS, "30 0 * * *"],
  ["check-arr-quality", "default", 5 * MINUTE_MS, "45 0 * * *"],
  ["scan-problems", "default", HOUR_MS, "50 0 * * *"],
  ["generate", "default", 4 * HOUR_MS, "0 1 * * *"],
  ["cleanup", "default", 4 * HOUR_MS, "0 4 * * *"],
  ["metadata", "default", 4 * HOUR_MS, "0 2 * * *"],
  ["metadata-overrides", "default", 4 * HOUR_MS, "30 2 * * *"],
  ["purge-runs", "internal", 10 * MINUTE_MS, "0 3 * * *"],
  ["backup", "internal", 15 * MINUTE_MS, "30 3 * * *"],
  ["sync-recently-added", "internal", 10 * MINUTE_MS, "*/15 * * * *"],
  ["sync-users", "default", 30 * MINUTE_MS, "0 */6 * * *"],
  ["seerr-poll", "internal", 5 * MINUTE_MS, "*/15 * * * *"],
  ["arr-poll", "internal", 2 * MINUTE_MS, "*/2 * * * *"],
  ["watchlist-sync", "internal", 5 * MINUTE_MS, "*/15 * * * *"],
  ["quality-swaps", "internal", 10 * MINUTE_MS, "*/5 * * * *"],
  ["rule-schedules", "internal", 5 * MINUTE_MS, "* * * * *"],
  ["healthcheck", "internal", 3 * MINUTE_MS, "* * * * *"],
  ["playback-poll", "internal", 2 * MINUTE_MS, "*/30 * * * * *"],
  ["bandwidth-test", "internal", 5 * MINUTE_MS, ""],
  ["collections-sweep", "interactive", HOUR_MS, ""],
  ["registry-updates", "internal", 5 * MINUTE_MS, "0 6 * * *"],
  ["posters-refresh", "default", 2 * HOUR_MS, "0 4 * * 0"],
  ["collection-art", "default", 2 * HOUR_MS, "0 5 * * *"],
  ["playback-backfill", "interactive", HOUR_MS, ""],
  ["label", "interactive", 30 * MINUTE_MS, ""],
  ["overlays-remove", "interactive", 2 * HOUR_MS, ""],
];

const FEATURES: Array<[id: string, lane: ScheduleLane, timeoutMs: number, schedule: string]> = [
  ["because-you-watched", "default", 30 * MINUTE_MS, "0 2 * * *"],
  ["we-think-youd-like", "default", 30 * MINUTE_MS, "0 3 * * 0"],
  ["shuffle", "default", 30 * MINUTE_MS, "*/30 * * * *"],
  ["overlays", "interactive", 2 * HOUR_MS, ""],
  ["digest", "default", 30 * MINUTE_MS, "0 9 * * MON"],
];

export const ALL_CAPABILITIES: ScheduleCapabilities = {
  seerr: true,
  arr: true,
  personalizedSharing: true,
  watchlist: true,
  notifier: true,
  backups: true,
};

export const NO_CAPABILITIES: ScheduleCapabilities = {
  seerr: false,
  arr: false,
  personalizedSharing: false,
  watchlist: false,
  notifier: false,
  backups: false,
};

function toJob([id, lane, timeoutMs, schedule]: (typeof ROWS)[number], feature: boolean): ScheduleJob {
  return {
    id,
    name: id,
    lane,
    timeoutMs,
    typicalMs: null,
    samples: 0,
    schedule,
    enabled: true,
    defaultSchedule: schedule,
    alwaysOn: isAlwaysOnJob(id),
    feature,
  };
}

export function fixtureContext(
  opts: { features?: boolean; capabilities?: ScheduleCapabilities; window?: boolean } = {},
): ScheduleContext {
  const jobs = [
    ...ROWS.map((r) => toJob(r, false)),
    ...(opts.features === false ? [] : FEATURES.map((r) => toJob(r, true))),
  ];
  return {
    jobs,
    capabilities: opts.capabilities ?? ALL_CAPABILITIES,
    serverTimezone: "UTC",
    settings: {
      timezone: "Europe/London",
      maintenanceWindow: { enabled: opts.window ?? true, from: "01:00", to: "06:00" },
      deferWhileStreaming: { enabled: true, maxWaitMinutes: 120, transcodesOnly: false },
    },
  };
}
