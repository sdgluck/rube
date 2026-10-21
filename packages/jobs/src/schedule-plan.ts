import { perDeps } from "@rube/container";
import { type Services } from "@rube/composition";
/**
 * The Jobs → Schedule page's server half: everything it needs in one read,
 * and every edit it makes in one write.
 *
 * One write rather than a `jobs.update` per job because a schedule is a
 * whole: applying a preset moves a dozen jobs at once, and doing that as a
 * dozen requests leaves the scheduler — and the change log — holding every
 * half-finished state in between. A failure halfway would strand some jobs in
 * the new night and the rest in the old one, overlapping each other.
 *
 * Validation is `validateSchedulePlan` from contracts, the same function the
 * page runs while you drag, so the server can't refuse something the page
 * showed as fine.
 */
import { eq } from "drizzle-orm";
import { Cron } from "croner";
import { jobs } from "@rube/db";
import {
  hasBlockingIssues,
  isAlwaysOnJob,
  isFeatureId,
  isValidTimezone,
  planFromContext,
  sameSchedule,
  validateSchedulePlan,
  type ScheduleContext,
  type ScheduleIssue,
  type ScheduleLane,
  type SchedulePlan,
  type ScheduleSettings,
} from "@rube/contracts";
import { createLogger } from "@rube/core";
import { COMMANDS, isCommandName } from "./commands/catalog.ts";
import { DEFAULT_JOBS, JobUpdateError } from "./runner.ts";
import { FEATURE_TEMPLATES } from "./features.ts";
import { createInternalJobs } from "./internal-jobs.ts";
import { createQueries } from "./queries.ts";
import { createSchedule } from "./schedule.ts";
import { createCapabilities } from "./capabilities.ts";

const log = createLogger("jobs");

/** Somebody else saved first. The router reports it as a 409 naming the jobs. */
export class JobScheduleConflictError extends Error {
  readonly jobIds: string[];
  readonly settings: Array<keyof ScheduleSettings>;
  constructor(jobIds: string[], settings: Array<keyof ScheduleSettings>) {
    super(
      `The schedule changed while you were editing it (${[...jobIds, ...settings].join(", ")}). Reload to see the latest.`,
    );
    this.name = "JobScheduleConflictError";
    this.jobIds = jobIds;
    this.settings = settings;
  }
}

export interface ScheduleJobChange {
  jobId: string;
  schedule?: string;
  enabled?: boolean;
  /** What the page last saw — the save is refused if the row no longer matches. */
  expected: { schedule: string; enabled: boolean };
}

export interface ScheduleUpdate {
  jobs: ScheduleJobChange[];
  settings?: { values: Partial<ScheduleSettings>; expected: Partial<ScheduleSettings> };
  /** "Applied the Recommended preset" — recorded with the change, shown in History. */
  summary?: string;
}

const DEFAULT_WINDOW = { enabled: false, from: "01:00", to: "06:00" };
const DEFAULT_DEFER = { enabled: false, maxWaitMinutes: 120, transcodesOnly: false };

const DEFAULT_SCHEDULES: Record<string, string> = Object.fromEntries([
  ...DEFAULT_JOBS.map((j) => [j.id, j.schedule]),
  ...FEATURE_TEMPLATES.map((f) => [f.id, f.defaultSchedule]),
]);

/** The zone used when the setting is empty: `TZ`, else the process's own. */
function serverTimezone(): string {
  const env = process.env.TZ?.trim();
  if (env && isValidTimezone(env)) return env;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function dayKey(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

export const createSchedulePlan = perDeps(function createSchedulePlan(deps: Services) {
  const { config, configHistory, db } = deps;
  const { getConfig, setConfig } = config;
  const { internalJobs } = createInternalJobs(deps);
  const { typicalDurations } = createQueries(deps);
  const { scheduleCron, restartSchedules } = createSchedule(deps);
  const { scheduleCapabilities } = createCapabilities(deps);

  function laneOf(command: string): { lane: ScheduleLane; timeoutMs: number } {
    if (isCommandName(command)) return { lane: COMMANDS[command].lane, timeoutMs: COMMANDS[command].timeoutMs };
    const internal = (internalJobs as Record<string, { timeoutMs: number } | undefined>)[command];
    return { lane: "internal", timeoutMs: internal?.timeoutMs ?? 30 * 60_000 };
  }

  function readSettings(): ScheduleSettings {
    return {
      timezone: getConfig("global_timezone") ?? "",
      maintenanceWindow: { ...DEFAULT_WINDOW, ...getConfig("jobs_maintenance_window") },
      deferWhileStreaming: { ...DEFAULT_DEFER, ...getConfig("jobs_defer_while_streaming") },
    };
  }

  function scheduleContext(): ScheduleContext & {
    now: number;
    notInstalled: Array<{ id: string; name: string; defaultSchedule: string }>;
  } {
    const rows = db.select().from(jobs).orderBy(jobs.id).all();
    const durations = typicalDurations();
    const installed = new Set(rows.map((r) => r.id));
    return {
      now: Date.now(),
      serverTimezone: serverTimezone(),
      settings: readSettings(),
      capabilities: scheduleCapabilities(),
      jobs: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...laneOf(row.command),
        typicalMs: durations[row.id]?.medianMs ?? null,
        samples: durations[row.id]?.samples ?? 0,
        schedule: row.schedule,
        enabled: row.enabled === 1,
        defaultSchedule: DEFAULT_SCHEDULES[row.id] ?? null,
        alwaysOn: isAlwaysOnJob(row.id),
        feature: isFeatureId(row.id),
      })),
      notInstalled: FEATURE_TEMPLATES.filter((f) => !installed.has(f.id)).map((f) => ({
        id: f.id,
        name: f.name,
        defaultSchedule: f.defaultSchedule,
      })),
    };
  }

  /**
   * Jobs whose run later today the change cancels: due later today under the
   * old schedule, and not again today under the new one. Moving a nightly job
   * from 23:00 to 22:00 at 22:30 means tonight's run doesn't happen — the
   * scheduler only catches up at boot — and the save should say so rather than
   * leave somebody waiting for it.
   */
  function skippedToday(changes: Array<{ id: string; from: string; to: string }>, timezone: string): string[] {
    const now = new Date();
    const today = dayKey(now, timezone);
    const next = (cron: string) => {
      if (!cron) return null;
      try {
        return new Cron(cron, { timezone, paused: true }).nextRun(now);
      } catch {
        return null;
      }
    };
    return changes
      .filter(({ from, to }) => {
        const before = next(from);
        if (!before || dayKey(before, timezone) !== today) return false;
        const after = next(to);
        return !after || dayKey(after, timezone) !== today;
      })
      .map((c) => c.id);
  }

  function updateSchedules(update: ScheduleUpdate): { issues: ScheduleIssue[]; skippedToday: string[] } {
    const ctx = scheduleContext();
    const byId = new Map(ctx.jobs.map((j) => [j.id, j]));

    // Conflicts first: validating against a state the user never saw would
    // report problems they can't recognise.
    const conflictJobs = update.jobs
      .filter((c) => {
        const job = byId.get(c.jobId);
        if (!job) throw new JobUpdateError(`Job "${c.jobId}" doesn't exist`);
        return job.schedule !== c.expected.schedule || job.enabled !== c.expected.enabled;
      })
      .map((c) => c.jobId);
    const conflictSettings = (Object.keys(update.settings?.expected ?? {}) as Array<keyof ScheduleSettings>).filter(
      (key) => JSON.stringify(update.settings!.expected[key]) !== JSON.stringify(ctx.settings[key]),
    );
    if (conflictJobs.length > 0 || conflictSettings.length > 0) {
      throw new JobScheduleConflictError(conflictJobs, conflictSettings);
    }

    const base = planFromContext(ctx);
    const proposed: SchedulePlan = {
      jobs: { ...base.jobs },
      settings: { ...base.settings, ...update.settings?.values },
    };
    for (const change of update.jobs) {
      proposed.jobs[change.jobId] = {
        schedule: change.schedule !== undefined ? change.schedule.trim() : proposed.jobs[change.jobId].schedule,
        enabled: change.enabled ?? proposed.jobs[change.jobId].enabled,
      };
    }

    const issues = validateSchedulePlan(proposed, ctx);
    if (hasBlockingIssues(issues)) {
      throw new JobUpdateError(
        issues
          .filter((i) => i.blocking)
          .map((i) => i.message)
          .join(" "),
      );
    }

    const changed = update.jobs
      .map((c) => ({ id: c.jobId, before: base.jobs[c.jobId], after: proposed.jobs[c.jobId] }))
      .filter((c) => c.before.enabled !== c.after.enabled || c.before.schedule !== c.after.schedule);
    const settingKeys = (Object.keys(update.settings?.values ?? {}) as Array<keyof ScheduleSettings>).filter(
      (key) => JSON.stringify(proposed.settings[key]) !== JSON.stringify(base.settings[key]),
    );
    if (changed.length === 0 && settingKeys.length === 0) {
      return { issues, skippedToday: [] };
    }

    const timezone = proposed.settings.timezone.trim() || ctx.serverTimezone;
    const skipped = skippedToday(
      changed
        .filter((c) => !sameSchedule(c.before.schedule, c.after.schedule) && c.after.enabled)
        .map((c) => ({ id: c.id, from: c.before.schedule, to: c.after.schedule })),
      timezone,
    );

    db.transaction(() => {
      for (const c of changed) {
        db.update(jobs)
          .set({ schedule: c.after.schedule, enabled: c.after.enabled ? 1 : 0 })
          .where(eq(jobs.id, c.id))
          .run();
      }
      // Logged below as part of the one entry, not as three settings edits.
      for (const key of settingKeys) {
        if (key === "timezone") setConfig("global_timezone", proposed.settings.timezone.trim(), { record: false });
        if (key === "maintenanceWindow")
          setConfig("jobs_maintenance_window", proposed.settings.maintenanceWindow, { record: false });
        if (key === "deferWhileStreaming")
          setConfig("jobs_defer_while_streaming", proposed.settings.deferWhileStreaming, { record: false });
      }
      configHistory.record({
        entity: "schedule",
        entityId: "jobs",
        action: "update",
        before: {
          jobs: Object.fromEntries(changed.map((c) => [c.id, c.before])),
          settings: Object.fromEntries(settingKeys.map((k) => [k, base.settings[k]])),
        },
        after: {
          ...(update.summary ? { summary: update.summary } : {}),
          jobs: Object.fromEntries(changed.map((c) => [c.id, c.after])),
          settings: Object.fromEntries(settingKeys.map((k) => [k, proposed.settings[k]])),
        },
      });
    });

    // croner bakes the zone in at construction, so a new zone means every
    // cron is rebuilt; otherwise only the ones that moved.
    if (settingKeys.includes("timezone")) {
      restartSchedules();
    } else {
      for (const c of changed) {
        const job = byId.get(c.id)!;
        scheduleCron({ id: c.id, name: job.name, schedule: c.after.schedule, enabled: c.after.enabled ? 1 : 0 });
      }
    }
    log.info("schedule saved", { jobs: changed.length, settings: settingKeys, summary: update.summary });

    return { issues: validateSchedulePlan(proposed, { ...ctx, ...applyStored(ctx, proposed) }), skippedToday: skipped };
  }

  /** The context as it stands after the save, so the warnings returned describe the new state. */
  function applyStored(ctx: ScheduleContext, plan: SchedulePlan): Pick<ScheduleContext, "jobs" | "settings"> {
    return {
      settings: plan.settings,
      jobs: ctx.jobs.map((j) => ({ ...j, ...plan.jobs[j.id] })),
    };
  }

  /**
   * Move jobs still on their shipped schedule to `plan`'s times, leaving any the
   * user has changed alone. For onboarding's "Use recommended", which runs on
   * installs that may already have opinions.
   */
  function applyToUntouchedDefaults(plan: SchedulePlan, summary: string): string[] {
    const ctx = scheduleContext();
    const changes = ctx.jobs
      .filter((j) => j.defaultSchedule !== null && sameSchedule(j.schedule, j.defaultSchedule))
      .filter((j) => plan.jobs[j.id] && !sameSchedule(plan.jobs[j.id].schedule, j.schedule))
      .map((j) => ({
        jobId: j.id,
        schedule: plan.jobs[j.id].schedule,
        expected: { schedule: j.schedule, enabled: j.enabled },
      }));
    if (changes.length === 0) return [];
    updateSchedules({ jobs: changes, summary });
    return changes.map((c) => c.jobId);
  }

  return { scheduleContext, updateSchedules, applyToUntouchedDefaults };
});
