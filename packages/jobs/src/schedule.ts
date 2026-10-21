import { perDeps } from "@rube/container";
import { type Services } from "@rube/composition";
import { createDeferral } from "./deferral.ts";
import { JobStarterToken } from "./starter.ts";
/**
 * Cron scheduling for jobs. Pulled out of runner.ts so the lifecycle
 * code doesn't share a file with cron plumbing (GET-124).
 *
 * There is a genuine cycle with runner.ts: the cron callback has to start a
 * job, and the runner has to register crons. It used to be broken by
 * `initSchedule(startJob)` assigning a module-level `let`, which the callback
 * then read as `startJob?.(…)` — so a process that never called it had every
 * cron fire and do nothing, with no error and no log line.
 *
 * It is a port now (`JobStarterToken`), bound once in `registerJobs` and
 * resolved when a cron actually fires. An unregistered starter fails to resolve
 * rather than dropping the run, and a test can swap it through the container.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { Cron } from "croner";
import { jobRuns, jobs } from "@rube/db";
import { createLogger, errorMessage, DAY_MS, HOUR_MS, MINUTE_MS } from "@rube/core";

const log = createLogger("jobs");

type ScheduledJob = { id: string; name: string; enabled: number; schedule: string };

/**
 * Map of jobId → active Cron. Exported so feature uninstall can stop a
 * cron without re-reading from the DB.
 */
export const cronJobs = new Map<string, Cron>();

/** Only catch up on schedules that fire less often than this. */
const CATCHUP_MIN_INTERVAL_MS = HOUR_MS;
/** Don't resurrect an occurrence older than this — it isn't "missed", it's history. */
const CATCHUP_MAX_AGE_MS = DAY_MS;
/** Space catch-up runs out so boot doesn't enqueue five jobs at once. */
const CATCHUP_STAGGER_MS = 5_000;

// Process-level: one timer per process, like the cron registry it sweeps.
let deferralSweep: ReturnType<typeof setInterval> | null = null;

/** How often to re-ask whether the server has gone quiet. */
const DEFERRAL_SWEEP_MS = MINUTE_MS;

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

export const createSchedule = perDeps(function createSchedule(deps: Services) {
  /** Snapshot of what's waiting, for the Jobs page. */
  function deferredStarts(): Array<{ jobId: string; jobName: string; waitingSince: number; deadline: number }> {
    return [...deferred.entries()].map(([jobId, entry]) => ({ jobId, ...entry }));
  }

  /**
   * Catch-up starts still waiting out their stagger.
   *
   * Held so they can be cancelled: an uncancellable timer outlived the
   * container that scheduled it, then resolved the job starter from a disposed
   * scope — an uncaught `DisposedScopeError` that failed CI at random.
   */
  const catchUpTimers = new Set<ReturnType<typeof setTimeout>>();

  /** Drop every pending deferral and catch-up start. For tests and shutdown. */
  function clearDeferredStarts(): void {
    deferred.clear();
    for (const timer of catchUpTimers) clearTimeout(timer);
    catchUpTimers.clear();
    if (deferralSweep) {
      clearInterval(deferralSweep);
      deferralSweep = null;
    }
  }

  /**
   * Scheduled starts that are waiting for the server to go quiet.
   *
   * Keyed by job id, so a second occurrence of the same job while it's already
   * waiting doesn't queue a second run — it just keeps the original deadline.
   * In memory rather than in a table on purpose: a deferral is worth exactly as
   * long as the process that owes it, and a restart should start the jobs it is
   * due rather than honour a wait decided before the reboot.
   */
  const deferred = new Map<string, { jobName: string; waitingSince: number; deadline: number }>();

  const { config, db } = deps;
  const { configuredTimezone } = config;
  const { deferralFor, maxDeferralMs } = createDeferral(deps);

  // Resolved when a cron fires rather than now: the runner is what builds this
  // module, so asking for it during construction would recurse.
  const startJob = (jobId: string): Promise<unknown> => deps.scope.resolve(JobStarterToken)(jobId);

  /**
   * The timezone every schedule is evaluated in.
   *
   * Kept as the scheduler's own name for it — croner is the reason the setting
   * exists — but resolved in core, because the maintenance window, seasonal rule
   * windows and the stats day boundaries all have to agree with cron about what
   * time it is.
   */
  function schedulerTimezone(): string | undefined {
    return configuredTimezone();
  }

  /**
   * Start a job the scheduler asked for, unless the server is busy.
   *
   * Only the cron path calls this. `startJob` remains the direct route, and is
   * what the UI's "Run now" still uses — a deferral applies to work the server
   * decided to do, never to work a person asked for.
   */
  function startScheduled(jobId: string, jobName: string, at: Date = new Date()): void {
    const verdict = deferralFor(jobId, at);
    if (!verdict) {
      deferred.delete(jobId);
      startJob(jobId).catch((err) => log.error("failed to start job", { job: jobName, err: errorMessage(err) }));
      return;
    }

    const existing = deferred.get(jobId);
    if (existing) {
      // Already waiting. Don't extend the deadline — the ceiling is measured
      // from the first occurrence that was held, not the most recent one, or an
      // hourly job on a busy evening would never reach it.
      return;
    }
    const now = Date.now();
    deferred.set(jobId, { jobName, waitingSince: now, deadline: now + maxDeferralMs() });
    log.info("holding a scheduled job back", { job: jobName, reason: verdict.reason });
    startDeferralSweep();
  }

  /** Re-check what's waiting: start anything now clear, or now out of patience. */
  function sweepDeferred(): void {
    if (deferred.size === 0) {
      if (deferralSweep) {
        clearInterval(deferralSweep);
        deferralSweep = null;
      }
      return;
    }

    const now = Date.now();
    // Snapshotted to an array because the loop deletes from the map it walks.
    const pending = Array.from(deferred.entries());
    for (const [jobId, entry] of pending) {
      const verdict = deferralFor(jobId);
      const expired = now >= entry.deadline;
      if (verdict && !expired) continue;

      deferred.delete(jobId);
      if (expired && verdict) {
        // Said out loud rather than silently: running anyway is the right
        // outcome, but it is the opposite of what the setting asked for, and a
        // user seeing this every night has learned their window is too tight.
        log.warn("running a deferred job anyway — waited long enough", {
          job: entry.jobName,
          reason: verdict.reason,
          waitedMs: now - entry.waitingSince,
        });
      } else {
        log.info("server went quiet — starting the job that was held", { job: entry.jobName });
      }
      startJob(jobId).catch((err) => log.error("failed to start job", { job: entry.jobName, err: errorMessage(err) }));
    }
  }

  function startDeferralSweep(): void {
    if (deferralSweep) return;
    deferralSweep = setInterval(sweepDeferred, DEFERRAL_SWEEP_MS);
    deferralSweep.unref?.();
  }

  function scheduleCron(job: ScheduledJob): void {
    const existing = cronJobs.get(job.id);
    if (existing) {
      existing.stop();
      cronJobs.delete(job.id);
    }

    if (!job.enabled || !job.schedule) return;

    const timezone = schedulerTimezone();
    try {
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
          startScheduled(job.id, job.name);
        },
      );
      cronJobs.set(job.id, cron);
    } catch (err) {
      // A schedule the user saved through the UI is validated, but a row written
      // by an older build or edited by hand isn't. Dropping one bad schedule is
      // recoverable; letting it throw out of `startCronSchedules` during
      // `initJobs` takes the whole server down on boot, repeatedly.
      log.error("could not schedule job — leaving it unscheduled", {
        job: job.name,
        schedule: job.schedule,
        timezone: timezone ?? "system",
        err: errorMessage(err),
      });
    }
  }

  /**
   * Run jobs whose scheduled firing was missed because the container was down.
   *
   * Deliberately conservative: only infrequent schedules, only the single most
   * recent occurrence, only within the last day, and every decision is logged —
   * a silent catch-up is as confusing as a silent skip.
   */
  function catchUpMissedRuns(now = Date.now()): string[] {
    if (!startJob) return [];
    const timezone = schedulerTimezone();
    const enabled = db
      .select()
      .from(jobs)
      .where(and(eq(jobs.enabled, 1), ne(jobs.schedule, "")))
      .all();

    const due: Array<{ id: string; name: string }> = [];
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
      due.push({ id: job.id, name: job.name });
    }

    // Through `startScheduled`, not `startJob`: a catch-up is the scheduler
    // deciding to do work, so the maintenance window and "defer while streaming"
    // apply to it exactly as they do to the occurrence it stands in for. Calling
    // `startJob` directly meant a restart at 20:30 fired `generate`, `cleanup`,
    // `metadata` and `sync-media` into the middle of somebody's film — the one
    // outcome the deferral gate exists to prevent.
    // Judged at `now` — the instant the occurrence was decided to be owed —
    // rather than whenever the stagger happens to fire. Re-reading the clock
    // inside the timeout made the gate answer for a moment up to a minute after
    // the one the catch-up reasoned about, which is both slightly wrong and, for
    // a window boundary, not reproducible.
    due.forEach((job, index) => {
      const timer = setTimeout(() => {
        catchUpTimers.delete(timer);
        startScheduled(job.id, job.name, new Date(now));
      }, index * CATCHUP_STAGGER_MS);
      timer.unref();
      catchUpTimers.add(timer);
    });

    return due.map((job) => job.id);
  }

  /**
   * (Re)build every cron from the DB.
   *
   * `catchUp` is opt-in and only passed at boot: re-creating the schedules
   * because the user changed their timezone is not evidence that anything was
   * missed, and firing a batch of jobs off the back of a settings save would be
   * a surprising thing for a settings save to do.
   */
  function startCronSchedules(opts: { catchUp?: boolean } = {}): void {
    // Tooling that boots the server only to look at it — the screenshot harness —
    // sets this. Otherwise the scheduler starts firing against the seeded data and
    // writes fresh run rows underneath the very pages being captured, so the same
    // screen renders differently on every run.
    if (process.env.TB_DISABLE_SCHEDULER === "1") {
      log.info("scheduler disabled by TB_DISABLE_SCHEDULER");
      return;
    }

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
  function restartSchedules(): void {
    startCronSchedules();
  }

  return {
    schedulerTimezone,
    scheduleCron,
    catchUpMissedRuns,
    startCronSchedules,
    restartSchedules,
    deferredStarts,
    clearDeferredStarts,
  };
});
