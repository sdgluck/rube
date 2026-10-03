/**
 * One-click schedules.
 *
 * A preset is a function of the install rather than a fixed table of times:
 * it packs the nightly jobs that exist, one after another, using how long each
 * actually takes here. A fixed table either leaves an hour idle on a small
 * library or stacks `cleanup` on a `generate` that is still running on a large
 * one, and the second is the shape that made the shipped defaults collide.
 *
 * Presets only ever change *when* jobs run, and the window and deferral
 * settings. They never switch a job on or off, never install a feature, and
 * never touch a job whose service isn't configured but which would quietly
 * start working the day it is (see `noopWithoutService`).
 *
 * Applied to the page's draft, not saved: the user sees the diff first.
 */
import { JOB_ORDER, RECOMMENDED_SCHEDULE_SETTINGS, isSchedulableJob, jobScheduleMeta } from "./job-schedule-meta.ts";
import { formatSchedule, MINUTE_MS } from "./job-schedule.ts";
import { parseClock } from "./clock.ts";
import {
  roundUpTo,
  typicalDurationMs,
  type ScheduleContext,
  type ScheduleJob,
  type SchedulePlan,
  type ScheduleSettings,
} from "./job-schedule-validate.ts";

/** The nightly chain, in the order ties are broken. `JOB_ORDER` decides the rest. */
const NIGHTLY = [
  "sync-media",
  "sync-collections",
  "sync-arr",
  "generate",
  "overlays",
  "metadata",
  "metadata-overrides",
  "purge-runs",
  "backup",
  "cleanup",
  "collection-art",
  "because-you-watched",
  "personalize",
  "posters-refresh",
];

interface PresetSpec {
  id: string;
  name: string;
  description: string;
  /** Settings the preset brings with it. */
  settings?: Partial<ScheduleSettings>;
  /** When the chain starts, `HH:MM`. */
  start: string;
  /** Extra room per job, as a fraction of its typical duration. */
  padding: number;
  /** Chain members that only run on these days. */
  days?: Record<string, number[]>;
  /** Chain members that run on the 1st of the month instead. */
  monthly?: string[];
  /** Jobs taken out of the chain and given a fixed cron. */
  fixed: Record<string, string>;
}

const SPECS: PresetSpec[] = [
  {
    id: "recommended",
    name: "Recommended",
    description:
      "The nightly jobs back to back inside a 01:00–06:00 window, in the order each needs the last, with room to spare. Waits while someone is watching.",
    settings: { ...RECOMMENDED_SCHEDULE_SETTINGS },
    start: "01:00",
    padding: 0.25,
    days: { "posters-refresh": [0] },
    fixed: {
      "sync-recently-added": "*/15 * * * *",
      "seerr-poll": "*/15 * * * *",
      "watchlist-sync": "*/15 * * * *",
      "arr-poll": "*/2 * * * *",
      "sync-users": "0 */6 * * *",
      shuffle: "*/30 * * * *",
      healthcheck: "* * * * *",
      "registry-updates": "0 6 * * *",
    },
  },
  {
    id: "compact",
    name: "Overnight compact",
    description:
      "Everything in the smallest window it fits — packed with no slack, starting at 02:00. For a server that's busy late and early.",
    settings: {
      maintenanceWindow: { enabled: true, from: "02:00", to: "05:30" },
      deferWhileStreaming: { ...RECOMMENDED_SCHEDULE_SETTINGS.deferWhileStreaming },
    },
    start: "02:00",
    padding: 0,
    days: { "posters-refresh": [0] },
    fixed: {
      "sync-recently-added": "*/15 * * * *",
      "seerr-poll": "*/15 * * * *",
      "watchlist-sync": "*/15 * * * *",
      "arr-poll": "*/2 * * * *",
      "sync-users": "0 */6 * * *",
      "registry-updates": "0 6 * * *",
    },
  },
  {
    id: "light",
    name: "Light / low-power",
    description:
      "For a NAS or a small box: heavy work later in a longer window, metadata and artwork weekly, posters monthly, and slower polling all day.",
    settings: {
      maintenanceWindow: { enabled: true, from: "01:00", to: "07:00" },
      deferWhileStreaming: { enabled: true, maxWaitMinutes: 180, transcodesOnly: false },
    },
    start: "03:00",
    padding: 0.25,
    days: { metadata: [0], "metadata-overrides": [0], "collection-art": [0] },
    monthly: ["posters-refresh"],
    fixed: {
      "sync-recently-added": "*/30 * * * *",
      "seerr-poll": "*/30 * * * *",
      "watchlist-sync": "*/30 * * * *",
      "arr-poll": "*/10 * * * *",
      "sync-users": "0 */12 * * *",
      shuffle: "0 */2 * * *",
      healthcheck: "*/5 * * * *",
      "registry-updates": "0 7 * * *",
    },
  },
  {
    id: "frequent",
    name: "Frequent refresh",
    description:
      "Library syncs every 6 hours and collections twice a day, so new additions show up the same day. Turns the window off — the syncs can't wait for it.",
    settings: { maintenanceWindow: { enabled: false, from: "01:00", to: "06:00" } },
    start: "02:00",
    padding: 0.25,
    days: { "posters-refresh": [0] },
    fixed: {
      "sync-media": "0 */6 * * *",
      "sync-collections": "10 */6 * * *",
      "sync-arr": "20 */6 * * *",
      generate: "30 */12 * * *",
      "sync-recently-added": "*/5 * * * *",
      "seerr-poll": "*/5 * * * *",
      "watchlist-sync": "*/5 * * * *",
      "arr-poll": "* * * * *",
      "sync-users": "0 */3 * * *",
      shuffle: "*/15 * * * *",
      healthcheck: "* * * * *",
      "registry-updates": "0 6 * * *",
    },
  },
];

export interface SchedulePreset {
  id: string;
  name: string;
  description: string;
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = SPECS.map(({ id, name, description }) => ({
  id,
  name,
  description,
}));

/**
 * Start times for `ids`, packed so each job starts once everything it depends
 * on has finished and its own queue is free.
 *
 * `default` and `interactive` each run one job at a time, so jobs on them are
 * laid end to end. Internal jobs run in-process alongside the queues, so they
 * only wait for their own predecessors. Every start is rounded up to a quarter
 * hour — times a person can read, and slack the estimate doesn't have.
 */
export function packChain(jobs: ScheduleJob[], start: number, padding: number): Record<string, number> {
  const ids = new Set(jobs.map((j) => j.id));
  const edges = JOB_ORDER.filter((e) => ids.has(e.before) && ids.has(e.after));
  const indegree = new Map(jobs.map((j) => [j.id, 0]));
  for (const e of edges) indegree.set(e.after, (indegree.get(e.after) ?? 0) + 1);

  // Kahn's algorithm, breaking ties by the order `jobs` came in.
  const order: ScheduleJob[] = [];
  const remaining = [...jobs];
  while (remaining.length > 0) {
    const next = remaining.findIndex((j) => indegree.get(j.id) === 0);
    // A cycle can't happen (the drift test forbids one), but if it did, carry
    // on in list order rather than looping forever.
    const [job] = remaining.splice(next === -1 ? 0 : next, 1);
    order.push(job);
    for (const e of edges) if (e.before === job.id) indegree.set(e.after, (indegree.get(e.after) ?? 1) - 1);
  }

  const ends = new Map<string, number>();
  const laneFree: Record<string, number> = { default: start, interactive: start };
  const out: Record<string, number> = {};
  for (const job of order) {
    let earliest = start;
    for (const e of edges) if (e.after === job.id) earliest = Math.max(earliest, ends.get(e.before) ?? start);
    if (job.lane !== "internal") earliest = Math.max(earliest, laneFree[job.lane]);
    const at = roundUpTo(earliest);
    const duration = Math.ceil((typicalDurationMs(job) * (1 + padding)) / MINUTE_MS);
    out[job.id] = at;
    ends.set(job.id, at + duration);
    if (job.lane !== "internal") laneFree[job.lane] = at + duration;
  }
  return out;
}

/** The plan a preset would produce from `base`. Pure; the page diffs it before anything is saved. */
export function buildPreset(presetId: string, ctx: ScheduleContext, base: SchedulePlan): SchedulePlan {
  const spec = SPECS.find((s) => s.id === presetId);
  if (!spec) throw new Error(`Unknown schedule preset "${presetId}"`);

  const jobs = { ...base.jobs };
  const settings: ScheduleSettings = { ...base.settings, ...spec.settings };
  const usable = (job: ScheduleJob) => {
    const meta = jobScheduleMeta(job.id);
    return isSchedulableJob(job.id) && !meta.pinned && jobs[job.id] !== undefined;
  };

  for (const job of ctx.jobs) {
    const cron = spec.fixed[job.id];
    if (cron !== undefined && usable(job)) jobs[job.id] = { ...jobs[job.id], schedule: cron };
  }

  const chain = NIGHTLY.flatMap((id) => {
    const job = ctx.jobs.find((j) => j.id === id);
    if (!job || !usable(job) || spec.fixed[id] !== undefined) return [];
    const entry = jobs[id];
    // Leave alone what's off, and what's manual: a preset moves work that
    // already runs. Overlays ships manual, and a preset that decided to burn
    // posters nightly — or to start a cleanup somebody parked — would be a
    // surprise nobody asked for.
    if (!entry.enabled || entry.schedule === "") return [];
    // Kept in the chain even when its service isn't set up: it's installed and
    // enabled, so leaving it at its old time would only collide with the jobs
    // that moved around it. `service-missing` says the rest.
    return [job];
  });

  const startMinute = parseClock(spec.start) ?? 60;
  const times = packChain(chain, startMinute, spec.padding);
  for (const [id, minute] of Object.entries(times)) {
    const time = minute % 1440;
    const days = spec.days?.[id];
    jobs[id] = {
      ...jobs[id],
      schedule: spec.monthly?.includes(id)
        ? `${time % 60} ${Math.floor(time / 60)} 1 * *`
        : formatSchedule(days ? { kind: "weekly", days, time } : { kind: "daily", time }),
    };
  }

  return { jobs, settings };
}
