/**
 * Cron scheduling for jobs. Pulled out of runner.ts so the lifecycle
 * code doesn't share a file with cron plumbing (GET-124).
 *
 * The cycle with runner.ts is broken by dependency injection: the cron
 * callback needs to call `startJob`, but `startJob` lives in runner.ts
 * which would otherwise want to import `scheduleCron` from here. The
 * runner calls `initSchedule(startJob)` once at boot; everything downstream
 * (schedule.scheduleCron, schedule.startCronSchedules) reaches startJob
 * through the closed-over reference.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { Cron } from "croner";
import { db, jobRuns, jobs } from "@tinkerbell/db";
import { createLogger, errorMessage, getConfig, DAY_MS, HOUR_MS } from "@tinkerbell/core";

const log = createLogger("jobs");

type ScheduledJob = { id: string; name: string; enabled: number; schedule: string };
type JobStarter = (jobId: string) => Promise<unknown>;

let startJob: JobStarter | null = null;

/**
 * Wire the cron callback. Called once by `initJobs` before any cron
 * schedule fires. After this, `scheduleCron` is safe to call.
 */
export function initSchedule(starter: JobStarter): void {
  startJob = starter;
}

/**
 * Map of jobId → active Cron. Exported so feature uninstall can stop a
 * cron without re-reading from the DB.
 */
export const cronJobs = new Map<string, Cron>();

/**
 * The timezone every schedule is evaluated in.
 *
 * Without this, croner follows the container's local time with nothing telling
 * the user what that is, and `0 3 * * *` double-fires or skips on DST
 * transitions. `global_timezone` is the user-visible setting; `TZ` is the
 * fallback for anyone who set it on the container instead.
 */
export function schedulerTimezone(): string | undefined {
  const configured = getConfig("global_timezone")?.trim();
  if (configured) return configured;
  const env = process.env.TZ?.trim();
  return env || undefined;
}

/** Only catch up on schedules that fire less often than this. */
const CATCHUP_MIN_INTERVAL_MS = HOUR_MS;
/** Don't resurrect an occurrence older than this — it isn't "missed", it's history. */
const CATCHUP_MAX_AGE_MS = DAY_MS;
/** Space catch-up runs out so boot doesn't enqueue five jobs at once. */
const CATCHUP_STAGGER_MS = 5_000;

export function scheduleCron(job: ScheduledJob): void {
  const existing = cronJobs.get(job.id);
  if (existing) {
    existing.stop();
    cronJobs.delete(job.id);
  }

  if (!job.enabled || !job.schedule) return;

  const timezone = schedulerTimezone();
  const cron = new Cron(
    job.schedule,
    {
      timezone,
      // Without `catch`, a throw inside the handler escapes into croner's own
      // timer, where nothing is listening for it.
      catch: (err: unknown) => log.error("cron handler threw", { job: job.name, err: errorMessage(err) }),
    },
    () => {
      log.info("cron triggered", { job: job.name });
      if (!startJob) {
        log.error("cron fired before initSchedule() — dropping", { job: job.name });
        return;
      }
      startJob(job.id).catch((err) => log.error("failed to start job", { job: job.name, err: errorMessage(err) }));
    },
  );
  cronJobs.set(job.id, cron);
}

/**
 * Median interval between firings, from two consecutive occurrences. Used to
 * decide whether a schedule is frequent enough that a missed firing doesn't
 * matter (the next one is minutes away regardless).
 */
function scheduleIntervalMs(expression: string, timezone: string | undefined): number | null {
  try {
    const probe = new Cron(expression, { timezone });
    const first = probe.nextRun();
    if (!first) return null;
    const second = probe.nextRun(first);
    if (!second) return null;
    return second.getTime() - first.getTime();
  } catch {
    return null;
  }
}

/**
 * The most recent occurrence at or before `now`, within the catch-up window.
 *
 * croner's own `previousRun()` reports the last time *this instance* actually
 * fired, which for a freshly-constructed Cron is always null — no use for
 * "when should this have run while we were down". So we walk forward from the
 * start of the window instead and keep the last occurrence that isn't in the
 * future. Returns null when nothing was due in the window at all.
 */
function previousOccurrence(expression: string, timezone: string | undefined, now: number): Date | null {
  let cron: Cron;
  try {
    cron = new Cron(expression, { timezone });
  } catch {
    return null;
  }
  // Bounded by construction: callers filter to schedules with an interval of
  // at least an hour, so the 24h window holds ~24 occurrences. The cap is a
  // backstop against a pattern that iterates faster than we expect.
  let cursor: Date = new Date(now - CATCHUP_MAX_AGE_MS);
  let last: Date | null = null;
  for (let i = 0; i < 200; i++) {
    const next = cron.nextRun(cursor);
    if (!next || next.getTime() > now) break;
    last = next;
    cursor = next;
  }
  return last;
}

/**
 * Run jobs whose scheduled firing was missed because the container was down.
 *
 * Deliberately conservative: only infrequent schedules, only the single most
 * recent occurrence, only within the last day, and every decision is logged —
 * a silent catch-up is as confusing as a silent skip.
 */
export function catchUpMissedRuns(now = Date.now()): string[] {
  if (!startJob) return [];
  const timezone = schedulerTimezone();
  const enabled = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.enabled, 1), ne(jobs.schedule, "")))
    .all();

  const due: string[] = [];
  for (const job of enabled) {
    const interval = scheduleIntervalMs(job.schedule, timezone);
    if (interval === null) continue;
    if (interval < CATCHUP_MIN_INTERVAL_MS) {
      log.debug("catch-up skipped: schedule is high-frequency", { job: job.name, intervalMs: interval });
      continue;
    }

    const previous = previousOccurrence(job.schedule, timezone, now);
    if (!previous) {
      log.debug("catch-up skipped: nothing was due within the window", { job: job.name });
      continue;
    }

    const lastRun = db
      .select({ startedAt: jobRuns.startedAt })
      .from(jobRuns)
      .where(eq(jobRuns.jobId, job.id))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1)
      .get();

    if (lastRun && lastRun.startedAt >= previous.getTime()) {
      log.debug("catch-up skipped: already ran after the occurrence", { job: job.name });
      continue;
    }

    log.info("catching up a missed occurrence", { job: job.name, missedAt: previous.toISOString() });
    due.push(job.id);
  }

  due.forEach((jobId, index) => {
    setTimeout(() => {
      startJob?.(jobId).catch((err) => log.error("catch-up run failed to start", { jobId, err: errorMessage(err) }));
    }, index * CATCHUP_STAGGER_MS).unref();
  });

  return due;
}

/**
 * (Re)build every cron from the DB.
 *
 * `catchUp` is opt-in and only passed at boot: re-creating the schedules
 * because the user changed their timezone is not evidence that anything was
 * missed, and firing a batch of jobs off the back of a settings save would be
 * a surprising thing for a settings save to do.
 */
export function startCronSchedules(opts: { catchUp?: boolean } = {}): void {
  // Stop everything first so this is safe to call again when the timezone
  // setting changes — every cron has to be rebuilt with the new zone.
  for (const cron of cronJobs.values()) cron.stop();
  cronJobs.clear();

  const enabledJobs = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.enabled, 1), ne(jobs.schedule, "")))
    .all();
  for (const job of enabledJobs) {
    scheduleCron(job);
  }
  log.info("started cron schedules", { count: enabledJobs.length, timezone: schedulerTimezone() ?? "system" });

  if (opts.catchUp) catchUpMissedRuns();
}

/**
 * Rebuild every schedule against the current timezone setting. Called by the
 * config router after `global_timezone` changes — croner bakes the zone in at
 * construction, so the existing Cron objects would keep the old one.
 */
export function restartSchedules(): void {
  startCronSchedules();
}
