/**
 * Every check the schedule page makes, as one pure function both sides run.
 *
 * The browser runs it on every drag so a warning appears while the block is
 * still under the pointer; the server runs it again on save and refuses
 * anything blocking. One implementation, because two would disagree about the
 * edge cases — a window that spans midnight, a weekly job against a daily one —
 * and the disagreement would surface as a save the page said was fine being
 * rejected.
 *
 * Errors only *block* when they involve something this save changes. A row an
 * older build wrote with a cron croner now rejects must not make every other
 * edit on the page unsaveable until the user finds and fixes it.
 */
import { z } from "zod";
import { formatClock, isValidTimezone, parseClock } from "./clock.ts";
import {
  JOB_ORDER,
  SCHEDULE_SERVICE_LABELS,
  isSchedulableJob,
  jobScheduleMeta,
  type ScheduleCapabilities,
} from "./job-schedule-meta.ts";
import {
  HOUR_MS,
  MINUTE_MS,
  WEEK_MINUTES,
  cronError,
  describeSchedule,
  dstShifts,
  formatSchedule,
  minGapMs,
  parseSchedule,
  sameSchedule,
  weekOccurrences,
  type JobSchedule,
} from "./job-schedule.ts";

export type ScheduleLane = "default" | "interactive" | "internal";

/** A job as the schedule page sees it: the stored row plus what the server knows. */
export interface ScheduleJob {
  id: string;
  name: string;
  lane: ScheduleLane;
  timeoutMs: number;
  /** Median of recent completed runs; null before there are any. */
  typicalMs: number | null;
  samples: number;
  /** Stored values — what the draft is compared against. */
  schedule: string;
  enabled: boolean;
  /** What a fresh install ships with; null for a job with no default row. */
  defaultSchedule: string | null;
  alwaysOn: boolean;
  feature: boolean;
}

/**
 * Shape only. Whether the values make sense — a real zone, a parseable window,
 * a sane wait — is `validateSchedulePlan`'s call, so a bad value comes back as
 * a sentence next to the field rather than a zod path.
 */
export const scheduleSettingsSchema = z.object({
  /** `""` = follow the server's clock. */
  timezone: z.string().max(100),
  maintenanceWindow: z.object({ enabled: z.boolean(), from: z.string().max(5), to: z.string().max(5) }),
  deferWhileStreaming: z.object({
    enabled: z.boolean(),
    maxWaitMinutes: z.number().int(),
    transcodesOnly: z.boolean(),
  }),
});

export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>;

export interface ScheduleContext {
  jobs: ScheduleJob[];
  settings: ScheduleSettings;
  capabilities: ScheduleCapabilities;
  /** The zone the server falls back to when `settings.timezone` is empty. */
  serverTimezone: string;
}

export interface JobPlanEntry {
  schedule: string;
  enabled: boolean;
}

/** A proposed state: every job's schedule and switch, and the settings. */
export interface SchedulePlan {
  jobs: Record<string, JobPlanEntry>;
  settings: ScheduleSettings;
}

export type ScheduleIssueCode =
  | "invalid-cron"
  | "never-fires"
  | "invalid-timezone"
  | "invalid-window"
  | "invalid-defer"
  | "interval-below-timeout"
  | "sub-minute"
  | "essential-manual"
  | "pinned-changed"
  | "always-on-disabled"
  | "not-schedulable"
  | "lane-overlap"
  | "same-start"
  | "order"
  | "outside-window"
  | "service-missing"
  | "frequent-heavy"
  | "overruns-window"
  | "recurring-on-batch-lane"
  | "dst";

export type ScheduleSeverity = "error" | "warning" | "info";

/** A one-click change that resolves an issue. Applied to the draft, never saved directly. */
export interface ScheduleFix {
  label: string;
  jobs?: Record<string, Partial<JobPlanEntry>>;
  settings?: Partial<ScheduleSettings>;
}

export interface ScheduleIssue {
  /** Stable across re-validation, for React keys and "dismissed" state. */
  key: string;
  code: ScheduleIssueCode;
  severity: ScheduleSeverity;
  /** An error that involves something being changed — the save is refused. */
  blocking: boolean;
  jobIds: string[];
  message: string;
  fixes: ScheduleFix[];
}

/** Heavy work running more often than this is worth a second look. */
export const FREQUENT_HEAVY_MS = 6 * HOUR_MS;
/** Every suggested time lands on a quarter hour. */
export const SNAP_MINUTES = 15;

export function planFromContext(ctx: ScheduleContext): SchedulePlan {
  return {
    jobs: Object.fromEntries(ctx.jobs.map((j) => [j.id, { schedule: j.schedule, enabled: j.enabled }])),
    settings: ctx.settings,
  };
}

export function applyFix(plan: SchedulePlan, fix: ScheduleFix): SchedulePlan {
  const jobs = { ...plan.jobs };
  for (const [id, patch] of Object.entries(fix.jobs ?? {})) {
    if (jobs[id]) jobs[id] = { ...jobs[id], ...patch };
  }
  return { jobs, settings: fix.settings ? { ...plan.settings, ...fix.settings } : plan.settings };
}

export function effectiveTimezone(plan: SchedulePlan, ctx: ScheduleContext): string {
  return plan.settings.timezone.trim() || ctx.serverTimezone;
}

/** How long a job usually takes, or the estimate before it has run. */
export function typicalDurationMs(job: Pick<ScheduleJob, "id" | "typicalMs">): number {
  return job.typicalMs ?? jobScheduleMeta(job.id).estimateMs;
}

export function roundUpTo(minutes: number, step = SNAP_MINUTES): number {
  return Math.ceil(minutes / step) * step;
}

export function isJobChanged(job: ScheduleJob, entry: JobPlanEntry | undefined): boolean {
  if (!entry) return false;
  return entry.enabled !== job.enabled || !sameSchedule(entry.schedule, job.schedule);
}

function settingsChanged(a: ScheduleSettings, b: ScheduleSettings): Record<keyof ScheduleSettings, boolean> {
  return {
    timezone: a.timezone.trim() !== b.timezone.trim(),
    maintenanceWindow: JSON.stringify(a.maintenanceWindow) !== JSON.stringify(b.maintenanceWindow),
    deferWhileStreaming: JSON.stringify(a.deferWhileStreaming) !== JSON.stringify(b.deferWhileStreaming),
  };
}

/** Is `minute` (of the day) inside the window? Spans midnight when `to < from`. */
export function inWindow(minute: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** A schedule that sits at one time of day: the only kind the timeline can move. */
function dayShaped(s: JobSchedule): s is Extract<JobSchedule, { kind: "daily" | "weekly" }> {
  return s.kind === "daily" || s.kind === "weekly";
}

function daysOf(s: Extract<JobSchedule, { kind: "daily" | "weekly" }>): number[] {
  return s.kind === "daily" ? [0, 1, 2, 3, 4, 5, 6] : s.days;
}

/** The same days, at another time. */
function withTime(s: Extract<JobSchedule, { kind: "daily" | "weekly" }>, time: number): string {
  return formatSchedule({ ...s, time: ((time % 1440) + 1440) % 1440 });
}

function formatDurationShort(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${Math.floor(hours)}h ${minutes % 60}m`;
}

export function validateSchedulePlan(plan: SchedulePlan, ctx: ScheduleContext): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const tz = effectiveTimezone(plan, ctx);
  const byId = new Map(ctx.jobs.map((j) => [j.id, j]));
  const changedSettings = settingsChanged(plan.settings, ctx.settings);
  const window = plan.settings.maintenanceWindow;
  const windowFrom = parseClock(window.from);
  const windowTo = parseClock(window.to);
  const windowOn = window.enabled && windowFrom !== null && windowTo !== null;
  const maxWait = plan.settings.deferWhileStreaming.maxWaitMinutes;
  const suggestedTime = windowOn ? windowFrom! : 120;

  const add = (
    code: ScheduleIssueCode,
    severity: ScheduleSeverity,
    jobIds: string[],
    message: string,
    fixes: ScheduleFix[] = [],
    changed = jobIds.some((id) => isJobChanged(byId.get(id)!, plan.jobs[id])),
  ) => {
    issues.push({
      key: `${code}:${jobIds.join(",")}`,
      code,
      severity,
      blocking: severity === "error" && changed,
      jobIds,
      message,
      fixes,
    });
  };

  // ── Settings ──────────────────────────────────────────────────────────────
  const tzValid = isValidTimezone(plan.settings.timezone);
  if (!tzValid) {
    add(
      "invalid-timezone",
      "error",
      [],
      `"${plan.settings.timezone}" isn't a timezone this server knows. Use an IANA name such as Europe/London.`,
      [{ label: "Use the server's timezone", settings: { timezone: "" } }],
      changedSettings.timezone,
    );
  }
  if (window.enabled && (windowFrom === null || windowTo === null)) {
    add(
      "invalid-window",
      "error",
      [],
      "The maintenance window needs a start and an end time.",
      [],
      changedSettings.maintenanceWindow,
    );
  }
  if (!Number.isInteger(maxWait) || maxWait < 1 || maxWait > 1440) {
    add(
      "invalid-defer",
      "error",
      [],
      "The longest a job will wait must be between 1 minute and 24 hours.",
      [
        {
          label: "Wait at most 2 hours",
          settings: { deferWhileStreaming: { ...plan.settings.deferWhileStreaming, maxWaitMinutes: 120 } },
        },
      ],
      changedSettings.deferWhileStreaming,
    );
  }

  // ── Per job ───────────────────────────────────────────────────────────────
  type Placed = { job: ScheduleJob; schedule: JobSchedule; starts: number[]; durMin: number };
  const placed: Placed[] = [];
  // croner neither skips nor doubles across a clock change: a start in the
  // hour that doesn't exist runs an hour late instead. Worth one footnote, not
  // a note per job — and only for spring; autumn's repeated hour runs once.
  const springForward = (tzValid ? dstShifts(tz) : []).find((s) => s.kind === "skipped");
  const lateOnDst: string[] = [];

  for (const job of ctx.jobs) {
    const entry = plan.jobs[job.id];
    if (!entry) continue;
    const meta = jobScheduleMeta(job.id);
    const changed = isJobChanged(job, entry);
    const cron = entry.schedule;
    const schedule = parseSchedule(cron);
    const restore: ScheduleFix = {
      label: `Restore ${job.name}'s schedule`,
      jobs: { [job.id]: { schedule: job.schedule } },
    };

    if (job.alwaysOn && !entry.enabled) {
      add("always-on-disabled", "error", [job.id], `${job.name} is always on and can't be switched off.`, [
        { label: "Switch it back on", jobs: { [job.id]: { enabled: true } } },
      ]);
    }
    if (!isSchedulableJob(job.id)) {
      if (cron !== "" && changed) {
        add("not-schedulable", "error", [job.id], `${job.name} is started from elsewhere and can't be scheduled.`, [
          { label: "Leave it manual", jobs: { [job.id]: { schedule: "" } } },
        ]);
      }
      continue;
    }
    if (meta.pinned && !sameSchedule(cron, job.schedule)) {
      add(
        "pinned-changed",
        "error",
        [job.id],
        `${job.name} is the clock every rule's own schedule runs on, so it can't be moved.`,
        [restore],
      );
    }

    const invalid = tzValid ? cronError(cron, tz) : null;
    if (invalid) {
      add(
        invalid === "never fires" ? "never-fires" : "invalid-cron",
        "error",
        [job.id],
        invalid === "never fires"
          ? `${job.name}'s schedule "${cron}" never fires.`
          : `${job.name}'s schedule "${cron}" isn't valid: ${invalid}.`,
        job.schedule && !cronError(job.schedule, tz) ? [restore] : [],
      );
      continue;
    }

    if (meta.essential && (cron === "" || !entry.enabled)) {
      const fallback = job.defaultSchedule || job.schedule;
      add(
        "essential-manual",
        meta.essential,
        [job.id],
        meta.essential === "error"
          ? `${job.name} has to run regularly — without it the database grows without limit.`
          : `${job.name} won't run unless started by hand, and what it keeps up to date will go stale.`,
        fallback
          ? [
              {
                label: `Schedule it (${describe(fallback)})`,
                jobs: { [job.id]: { schedule: fallback, enabled: true } },
              },
            ]
          : [],
      );
    }

    if (!entry.enabled || cron === "") continue;

    const gap = minGapMs(cron, tz);
    if (gap < MINUTE_MS && !meta.allowSeconds) {
      add("sub-minute", "error", [job.id], `${job.name} can't run more than once a minute.`, [
        { label: "Every minute", jobs: { [job.id]: { schedule: "* * * * *" } } },
      ]);
    }
    if (meta.heavy && gap < job.timeoutMs) {
      add(
        "interval-below-timeout",
        "error",
        [job.id],
        `${job.name} can take up to ${formatDurationShort(job.timeoutMs)}, so it can't be scheduled every ${formatDurationShort(gap)} — a run would still be going when the next is due.`,
        [
          {
            label: `Run daily at ${formatClock(suggestedTime)}`,
            jobs: { [job.id]: { schedule: withTime({ kind: "daily", time: 0 }, suggestedTime) } },
          },
        ],
      );
    } else if (meta.heavy && gap < FREQUENT_HEAVY_MS) {
      add(
        "frequent-heavy",
        "warning",
        [job.id],
        `${job.name} walks the whole library, and every ${formatDurationShort(gap)} is a lot of load on Plex for little change.`,
        [
          {
            label: `Run daily at ${formatClock(suggestedTime)}`,
            jobs: { [job.id]: { schedule: withTime({ kind: "daily", time: 0 }, suggestedTime) } },
          },
        ],
      );
    }

    if (meta.requires && !ctx.capabilities[meta.requires] && !meta.noopWithoutService) {
      add(
        "service-missing",
        "warning",
        [job.id],
        `${job.name} needs ${SCHEDULE_SERVICE_LABELS[meta.requires]}, which isn't set up — every run will do nothing.`,
        [{ label: "Don't schedule it", jobs: { [job.id]: { schedule: "" } } }],
      );
    }

    const durMin = Math.max(1, Math.ceil(typicalDurationMs(job) / MINUTE_MS));

    if (meta.heavy && windowOn) {
      if (dayShaped(schedule)) {
        if (!inWindow(schedule.time, windowFrom!, windowTo!)) {
          add(
            "outside-window",
            "warning",
            [job.id],
            `${job.name} starts at ${formatClock(schedule.time)}, outside the maintenance window (${window.from}–${window.to}). It waits for the window for at most ${maxWait} min, then runs anyway.`,
            [{ label: `Move to ${window.from}`, jobs: { [job.id]: { schedule: withTime(schedule, windowFrom!) } } }],
          );
        } else {
          const windowLen = (windowTo! - windowFrom! + 1440) % 1440 || 1440;
          const into = (schedule.time - windowFrom! + 1440) % 1440;
          if (into + durMin > windowLen) {
            add(
              "overruns-window",
              "info",
              [job.id],
              `${job.name} usually takes ${formatDurationShort(durMin * MINUTE_MS)}, so it runs past the end of the window at ${window.to}. It isn't stopped — the window only decides when work may start.`,
            );
          }
        }
      } else if (schedule.kind === "interval") {
        add(
          "outside-window",
          "warning",
          [job.id],
          `${job.name} runs every ${formatDurationShort(gap)}, but heavy jobs only start inside the maintenance window (${window.from}–${window.to}) — most of its runs will be held back and then pile up.`,
          [
            {
              label: `Run daily at ${window.from}`,
              jobs: { [job.id]: { schedule: withTime({ kind: "daily", time: 0 }, windowFrom!) } },
            },
            { label: "Turn the window off", settings: { maintenanceWindow: { ...window, enabled: false } } },
          ],
        );
      }
    }

    if (
      dayShaped(schedule) &&
      springForward &&
      schedule.time >= springForward.from &&
      schedule.time < springForward.to
    ) {
      lateOnDst.push(job.id);
    }

    const starts = weekOccurrences(cron, tz);
    if (starts) placed.push({ job, schedule, starts, durMin });
    else if (job.lane === "default") {
      // Frequent work on the batch lane queues behind whatever the night is doing.
      const longest = ctx.jobs
        .filter((other) => other.lane === "default" && other.id !== job.id && plan.jobs[other.id]?.enabled)
        .filter((other) => dayShaped(parseSchedule(plan.jobs[other.id].schedule)))
        .sort((a, b) => typicalDurationMs(b) - typicalDurationMs(a))[0];
      if (longest && typicalDurationMs(longest) > gap) {
        add(
          "recurring-on-batch-lane",
          "info",
          [job.id],
          `${job.name} shares a queue with the nightly batch, so while ${longest.name} runs (typically ${formatDurationShort(typicalDurationMs(longest))}) it waits.`,
        );
      }
    }
  }

  if (springForward && lateOnDst.length > 0) {
    const date = new Date(springForward.at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: tz,
    });
    const names = lateOnDst.map((id) => byId.get(id)!.name);
    add(
      "dst",
      "info",
      lateOnDst,
      `On ${date} the clocks go forward and ${formatClock(springForward.from)}–${formatClock(springForward.to)} doesn't happen, so ${names.join(", ")} will run an hour late that night.`,
    );
  }

  // ── Lane overlap ──────────────────────────────────────────────────────────
  // `default` and `interactive` each run one job at a time, so an overlap is a
  // queue: the later job starts when the earlier one finishes. Internal jobs
  // run in-process alongside everything and never wait.
  const reported = new Set<string>();
  const ordered = new Set(JOB_ORDER.map((e) => `${e.before}>${e.after}`));
  for (const lane of ["default", "interactive"] as const) {
    const occ = placed
      .filter((p) => p.job.lane === lane)
      .flatMap((p) => p.starts.map((start) => ({ p, start, end: start + p.durMin })))
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < occ.length; i++) {
      for (let j = 0; j < occ.length; j++) {
        if (i === j) continue;
        const a = occ[i];
        const b = occ[j];
        if (a.p.job.id === b.p.job.id) continue;
        // Compare across the week boundary too: Saturday 23:30 runs into Sunday.
        const bStart = b.start < a.start ? b.start + WEEK_MINUTES : b.start;
        const same = bStart === a.start;
        if (!same && bStart >= a.end) continue;
        if (same && a.p.job.id > b.p.job.id) continue;
        const pair = `${a.p.job.id}|${b.p.job.id}`;
        if (reported.has(pair) || reported.has(`${b.p.job.id}|${a.p.job.id}`)) continue;
        reported.add(pair);
        // An ordering edge broken by this pair is reported once, as an order issue.
        if (ordered.has(`${b.p.job.id}>${a.p.job.id}`)) continue;
        const moveTo = roundUpTo((a.start % 1440) + a.p.durMin);
        const fixes = dayShaped(b.p.schedule)
          ? [
              {
                label: `Move ${b.p.job.name} to ${formatClock(moveTo)}`,
                jobs: { [b.p.job.id]: { schedule: withTime(b.p.schedule, moveTo) } },
              },
            ]
          : [];
        if (same) {
          add(
            "same-start",
            "warning",
            [a.p.job.id, b.p.job.id],
            `${a.p.job.name} and ${b.p.job.name} both start at ${formatClock(a.start % 1440)} on the same queue, so which goes first is down to chance.`,
            fixes,
          );
        } else {
          add(
            "lane-overlap",
            "warning",
            [a.p.job.id, b.p.job.id],
            `${b.p.job.name} is due at ${formatClock(b.start % 1440)} while ${a.p.job.name} is usually still running (until about ${formatClock(a.end % 1440)}), so it will start late.`,
            fixes,
          );
        }
      }
    }
  }

  // ── Ordering ──────────────────────────────────────────────────────────────
  // Read as positions in a "night" that starts when the window opens (or at
  // noon), so 23:30 → 00:30 counts as in order rather than 23 hours apart.
  const anchor = windowOn ? windowFrom! : 720;
  const pos = (t: number) => (t - anchor + 1440) % 1440;
  const placedById = new Map(placed.map((p) => [p.job.id, p]));
  // A job that does nothing until its service is set up has no output to wait for.
  const dormant = (id: string) => {
    const meta = jobScheduleMeta(id);
    return !!meta.requires && !!meta.noopWithoutService && !ctx.capabilities[meta.requires];
  };
  for (const edge of JOB_ORDER) {
    const before = placedById.get(edge.before);
    const after = placedById.get(edge.after);
    if (!before || !after) continue;
    if (dormant(before.job.id) || dormant(after.job.id)) continue;
    if (!dayShaped(before.schedule) || !dayShaped(after.schedule)) continue;
    const shared = daysOf(before.schedule).some((d) =>
      daysOf(after.schedule as Extract<JobSchedule, { kind: "daily" | "weekly" }>).includes(d),
    );
    if (!shared) continue;
    const queued = before.job.lane === after.job.lane && before.job.lane !== "internal";
    // On a shared queue, starting second is enough: the queue does the waiting.
    const inOrder = (b: number, a: number) => (queued ? pos(a) > pos(b) : pos(a) >= pos(b) + before.durMin);
    if (inOrder(before.schedule.time, after.schedule.time)) continue;
    // Two candidate moves, each offered only if it actually puts the pair in
    // order — a job parked at the very end of the night can't be followed, so
    // the useful fix there is to move it earlier. Both clear the earlier job's
    // finish, even on a shared queue: the same minute would only trade this
    // warning for a "same start" one.
    const fixes: ScheduleFix[] = [];
    const afterTo = roundUpTo(before.schedule.time + before.durMin) % 1440;
    if (inOrder(before.schedule.time, afterTo)) {
      fixes.push({
        label: `Move ${after.job.name} to ${formatClock(afterTo)}`,
        jobs: { [after.job.id]: { schedule: withTime(after.schedule, afterTo) } },
      });
    }
    const beforeTo = (Math.floor((after.schedule.time - before.durMin) / SNAP_MINUTES) * SNAP_MINUTES + 1440) % 1440;
    if (inOrder(beforeTo, after.schedule.time)) {
      fixes.push({
        label: `Move ${before.job.name} to ${formatClock(beforeTo)}`,
        jobs: { [before.job.id]: { schedule: withTime(before.schedule, beforeTo) } },
      });
    }
    add(
      "order",
      "warning",
      [edge.before, edge.after],
      `${after.job.name} should run after ${before.job.name} has finished — ${edge.reason}.`,
      fixes,
    );
  }

  const rank: Record<ScheduleSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** "daily at 03:00", "every minute" — for a fix label, mid-sentence. */
function describe(cron: string): string {
  const text = describeSchedule(parseSchedule(cron));
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Can this plan be saved? */
export function hasBlockingIssues(issues: ScheduleIssue[]): boolean {
  return issues.some((i) => i.blocking);
}

/** The jobs whose schedule or switch differ between two plans. */
export function diffSchedulePlans(
  base: SchedulePlan,
  next: SchedulePlan,
): Array<{ jobId: string; from: JobPlanEntry; to: JobPlanEntry }> {
  const out: Array<{ jobId: string; from: JobPlanEntry; to: JobPlanEntry }> = [];
  for (const [jobId, to] of Object.entries(next.jobs)) {
    const from = base.jobs[jobId];
    if (!from) continue;
    if (from.enabled !== to.enabled || !sameSchedule(from.schedule, to.schedule)) out.push({ jobId, from, to });
  }
  return out;
}

export function diffScheduleSettings(base: SchedulePlan, next: SchedulePlan): Array<keyof ScheduleSettings> {
  const changed = settingsChanged(base.settings, next.settings);
  return (Object.keys(changed) as Array<keyof ScheduleSettings>).filter((k) => changed[k]);
}
