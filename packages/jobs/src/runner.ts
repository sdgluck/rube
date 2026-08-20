import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";
import { createStressTest } from "./stress-test/index.ts";
import { createInternalJobs } from "./internal-jobs.ts";
import { createSchedule } from "./schedule.ts";
import { createRuleQueue } from "./rule-queue.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { eq, and, desc, inArray, notInArray, sql, type InferSelectModel } from "drizzle-orm";
import { Cron } from "croner";

import { jobs, jobRuns } from "@tinkerbell/db";

import {
  createLogger,
  deriveJobContext,
  errorMessage,
  formatDuration,
  logLevel,
  runAsActor,
  type JobContext,
} from "@tinkerbell/core";

import { type InternalJobDescriptor, type InternalJobName } from "./internal-jobs.ts";
import {} from "./schedule.ts";

import { COMMANDS, isCommandName, type CommandName } from "./commands/catalog.ts";
import { ACTIVE_RUN_STATUSES, isTerminalStatus } from "./statuses.ts";
import {
  JOB_CANCELLING_GRACE_MS,
  JOB_RUN_KEEP_PER_JOB,
  JOB_TIMEOUT_GRACE_MS,
  JOB_WATCHDOG_INTERVAL_MS,
} from "./limits.ts";

const log = createLogger("jobs");

type Job = InferSelectModel<typeof jobs>;

/** Every command a job row may point at: a queued command, or an in-process internal job. */
export type JobCommand = CommandName | InternalJobName;

// System + always-seeded background/escape-hatch jobs. Features are NOT here
// — they're created on demand via installFeature(). See FEATURE_TEMPLATES.
//
// `command` is typed as `JobCommand`, so a rename in the catalog that isn't
// mirrored here is a typecheck failure rather than a runtime "Unknown command".
export const DEFAULT_JOBS: (Omit<Job, "config" | "command"> & { command: JobCommand })[] = [
  // ── System (infrastructure) ─────────────────────────────────────────────
  { id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "0 0 * * *", enabled: 1 },
  { id: "sync-collections", name: "Sync Collections", command: "sync-collections", schedule: "0 0 * * *", enabled: 1 },
  { id: "generate", name: "Generate Collections", command: "generate", schedule: "0 1 * * *", enabled: 1 },
  // 4am: after sync-media (midnight) so the library index the cleanup guards
  // read is fresh, after generate (1am) so a rule's shelf reflects the night's
  // collections, and clear of purge-runs (3am).
  { id: "cleanup", name: "Cleanup", command: "cleanup", schedule: "0 4 * * *", enabled: 1 },
  // 2am: after sync-media, and *before* generate's 1am work has been overtaken
  // by anything — a sort title fixed here should be what the next night's
  // collections sort on. Clear of purge-runs (3am) and cleanup (4am).
  { id: "metadata", name: "Apply Metadata", command: "metadata", schedule: "0 2 * * *", enabled: 1 },
  { id: "purge-runs", name: "Purge Old Runs", command: "purge-runs", schedule: "0 3 * * *", enabled: 1 },
  // 3:30am: after purge-runs has trimmed the tables it trims, so the copy is
  // of a database that has already shed a night's worth of expired rows, and
  // before cleanup (4am) does anything destructive — a backup taken *before*
  // the job that deletes files is the one you want afterwards.
  { id: "backup", name: "Back Up Database", command: "backup", schedule: "30 3 * * *", enabled: 1 },
  {
    id: "sync-recently-added",
    name: "Sync Recently Added",
    command: "sync-recently-added",
    schedule: "*/15 * * * *",
    enabled: 1,
  },
  { id: "sync-users", name: "Sync Plex Users", command: "sync-users", schedule: "0 */6 * * *", enabled: 1 },
  // Same cadence as the recently-added sync, and for the same reason: it is
  // the source of a rule trigger, so its period is the trigger's latency. It
  // no-ops in a few microseconds when Overseerr isn't configured.
  { id: "seerr-poll", name: "Poll Overseerr Requests", command: "seerr-poll", schedule: "*/15 * * * *", enabled: 1 },
  // Same cadence and the same reasoning as the Overseerr poll: the period is
  // the latency between someone tapping the watchlist button in the Plex app
  // and the download starting, and that is the whole experience of the
  // feature. It returns in milliseconds without touching the network when
  // watchlist sync is switched off, which it is until somebody configures it.
  {
    id: "watchlist-sync",
    name: "Sync Plex Watchlist",
    command: "watchlist-sync",
    schedule: "*/15 * * * *",
    enabled: 1,
  },
  // Every minute, because it is a poll for "has any rule's own cron come due"
  // rather than work in itself — see rule-schedules.ts for why a poll and not
  // a live Cron per rule. Most ticks read the rules table and stop.
  {
    id: "rule-schedules",
    name: "Run Scheduled Rules",
    command: "rule-schedules",
    schedule: "* * * * *",
    enabled: 1,
  },
  { id: "healthcheck", name: "Healthcheck", command: "healthcheck", schedule: "* * * * *", enabled: 1 },
  // Six-field schedule — croner reads a leading seconds field, which every
  // other job here omits. 30s is Tautulli's default and the trade-off is
  // sampling density against API load: a 22-minute episode gets ~44 samples
  // for one small request per tick. Anything slower starts missing short items
  // entirely, which silently under-counts exactly the content people rewatch.
  {
    id: "playback-poll",
    name: "Poll Playback Sessions",
    command: "playback-poll",
    schedule: "*/30 * * * * *",
    enabled: 1,
  },
  // No schedule by default: the test saturates the very link people are
  // streaming over, so it runs when a human asks. A schedule can still be set
  // from the UI for anyone who wants a nightly figure.
  { id: "bandwidth-test", name: "Bandwidth Test", command: "bandwidth-test", schedule: "", enabled: 1 },
  // No schedule by default: it deletes collections off the Plex server, so it
  // runs when a human asks it to. A schedule can still be set from the UI.
  {
    id: "collections-sweep",
    name: "Clean Up Duplicate Collections",
    command: "collections-sweep",
    schedule: "",
    enabled: 1,
  },
  // Daily and off-peak. The registry index is cached for an hour, so this is
  // one small GET a day against tinkerbell.dev.
  {
    id: "registry-updates",
    name: "Check Registry Updates",
    command: "registry-updates",
    schedule: "0 6 * * *",
    enabled: 1,
  },
  {
    id: "posters-refresh",
    name: "Refresh Poster Cache",
    command: "posters-refresh",
    schedule: "0 4 * * 0",
    enabled: 1,
  },
  // Scheduled after `generate` (01:00) rather than triggered by it: `generate`
  // executes in a Sidequest worker thread, and the queue engine only runs in
  // the main process, so it has nothing to enqueue with. Running hours later
  // is correct by construction anyway — this job finds the rule's collections
  // by label at run time rather than by rating keys that a re-run has already
  // invalidated.
  {
    id: "collection-art",
    name: "Generate Collection Artwork",
    command: "collection-art",
    schedule: "0 5 * * *",
    enabled: 1,
  },
  // No schedule — a one-shot import that resumes where it left off. Re-running
  // it on a timer would walk Plex's history forever for nothing.
  {
    id: "playback-backfill",
    name: "Import Plex Watch History",
    command: "playback-backfill",
    schedule: "",
    enabled: 1,
  },
  // ── Background / escape-hatch (hidden from UI, invoked via Settings or BYW lifecycle) ──
  { id: "label", name: "Apply Collection Restrictions", command: "label", schedule: "", enabled: 1 },
  { id: "label-undo", name: "Clear Tinkerbell Labels", command: "label-undo", schedule: "", enabled: 1 },
  { id: "metadata-undo", name: "Revert Metadata Changes", command: "metadata-undo", schedule: "", enabled: 1 },
  { id: "byw-remove", name: "Remove Because You Watched", command: "byw-remove", schedule: "", enabled: 1 },
  {
    id: "personalize-enable",
    name: "Enable Personalized Home Screens",
    command: "personalize-enable",
    schedule: "",
    enabled: 1,
  },
  {
    id: "personalize-disable",
    name: "Disable Personalized Home Screens",
    command: "personalize-disable",
    schedule: "",
    enabled: 1,
  },
  { id: "overlays-remove", name: "Remove Overlays", command: "overlays", schedule: "", enabled: 1 },
  // No schedule — only ever triggered explicitly from Settings → Migrate.
  // One job covers all migration providers; the providerId is read from
  // `migration_pending_plan` at run time.
  {
    id: "migrate-collections",
    name: "Migrate Collections",
    command: "migrate-collections",
    schedule: "",
    enabled: 1,
  },
  // No schedule — triggered by the Prerolls page whenever a file is uploaded
  // or imported. There is nothing to do until one is.
  {
    id: "preroll-process",
    name: "Process Prerolls",
    command: "preroll-process",
    schedule: "",
    enabled: 1,
  },
];

const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  "overlays-remove": { mode: "remove" },
};

// `sync-most-watched` retired in favour of playback history: most-watched and
// the activity summary are now derived from playback_sessions at query time
// rather than cached by a job. Its row must be deleted on upgrade or the
// scheduler would keep firing a command that no longer exists.
const REMOVED_JOBS = ["sync-sections", "stress-test", "migrate-kometa", "sync-most-watched"];

/**
 * Sidequest engine configuration. Extracted so it can be asserted in a unit
 * test without booting the engine — two of these settings are load-bearing
 * enough that a silent revert would be a production incident.
 */
export function buildEngineConfig(dbPath: string) {
  return {
    backend: { driver: "@sidequest/sqlite-backend" as const, config: dbPath },
    queues: [
      // Scheduled batch work. One at a time — these are heavy and mostly
      // Plex-bound, and running two concurrently just moves the bottleneck.
      { name: "default", concurrency: 1, priority: 50, state: "active" as const },
      // Human-triggered work, watched in the UI. Its own lane so a preroll
      // upload doesn't queue behind an hour-long nightly `generate`.
      { name: "interactive", concurrency: 1, priority: 100, state: "active" as const },
    ],
    // One slot per queue, so the lanes are genuinely independent. Two workers
    // writing to SQLite is fine under WAL + busy_timeout=5000, especially now
    // that log flushes are small appends rather than whole-column rewrites.
    maxConcurrentJobs: 2,
    manualJobResolution: true,
    jobsFilePath: join(import.meta.dirname, "sidequest", "registry.ts"),
    gracefulShutdown: true,
    // We own liveness ourselves: `markStaleRunsAsFailed()` on boot plus the
    // watchdog below. Sidequest's stale sweep has no heartbeat — it treats any
    // job running >10min as dead and re-runs it underneath us, which for
    // `label`/`overlays`/`personalize` means re-applying Plex-side effects.
    //
    // Do NOT reach for `.unique(true)` as a substitute: uniqueness is keyed on
    // the job *class*, and every command shares the single `CommandJob` class,
    // so it would make one running command block every other from enqueuing.
    releaseStaleJobsIntervalMin: false as const,
    // Retries belong at the HTTP-client layer, not around a whole command with
    // partially-applied Plex side effects.
    jobDefaults: { maxAttempts: 1 },
    logger: { level: logLevel() },
  };
}

async function startSidequest(): Promise<void> {
  const { Sidequest } = await import("sidequest");
  const dbPath = join(process.env.DATA_DIR || join(import.meta.dirname, "..", "..", "..", ".."), "sidequest.sqlite");
  await Sidequest.start(buildEngineConfig(dbPath) as never);
  log.info("Sidequest engine started");
}

// Module level on purpose, unlike the application state that moved into the
// factory. This guards the Sidequest engine, which is one per process (and one
// per worker thread) rather than one per container — a container-scoped latch
// would claim a lifetime the engine does not have.
let shuttingDown = false;

/**
 * Set by `stopSidequest` so in-flight job code can decide whether a DB
 * write failure is just the engine tearing down (silent) or something
 * to actually log (everything else).
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

export async function stopSidequest(): Promise<void> {
  shuttingDown = true;
  if (watchdogTimer) clearInterval(watchdogTimer);
  try {
    const { Sidequest } = await import("sidequest");
    await Sidequest.stop();
    log.info("Sidequest engine stopped");
  } catch {
    // Engine may not have started
  }
}

export type StartResult =
  | { ok: true; runId: string }
  /**
   * `unknown-command` still creates a run row (failed, with an explanation) so
   * the user has something to look at — but the start did not succeed, and
   * saying `ok: true` would have made a caller checking that flag believe work
   * was underway.
   */
  | { ok: false; reason: "not-found" | "already-running" | "unknown-command"; runId?: string };

// ── Watchdog ────────────────────────────────────────────────────────────────

// Process-level with the engine it watches; see `shuttingDown`.
let watchdogTimer: NodeJS.Timeout | null = null;

export const createRunner = perDeps(function createRunner(deps: Services) {
  /**
   * In-flight internal jobs, so `cancelRun` can abort them. Command jobs run in
   * a worker thread and are cancelled via the `job_runs.status` poll instead.
   */
  const internalControllers = new Map<string, AbortController>();
  /**
   * When each `cancelling` run was asked to stop, so the watchdog can force-fail
   * one that never unwinds. In memory rather than a column because a restart
   * fails every in-flight run anyway (`markStaleRunsAsFailed`), which makes the
   * durable version pure cost.
   */
  const cancelRequestedAt = new Map<string, number>();

  const { config, configHistory, db, events, ruleRuns, rules } = deps;
  const { record: recordChange } = configHistory;
  const { seedDefaultRules } = rules;
  const { markStaleRuleRunsAsFailed, sweepStuckRuleRuns } = ruleRuns;
  const { emitEvent } = events;
  const { migrateCleanupBudgetKey } = config;
  const { markStaleStressTestsAsFailed } = createStressTest(deps);
  const { internalJobs, isInternalJobName } = createInternalJobs(deps);
  const { scheduleCron, startCronSchedules } = createSchedule(deps);
  const { hasQueuedRuleWork, scheduleRuleDrain } = createRuleQueue(deps);

  function seedDefaultJobs(): void {
    const existing = new Map(
      db
        .select({ id: jobs.id, name: jobs.name, command: jobs.command })
        .from(jobs)
        .all()
        .map((r) => [r.id, r]),
    );

    let inserted = 0;
    let updated = 0;
    for (const job of DEFAULT_JOBS) {
      const current = existing.get(job.id);
      if (!current) {
        db.insert(jobs)
          .values({ ...job, config: DEFAULT_CONFIGS[job.id] ?? {} })
          .run();
        inserted++;
        continue;
      }
      // Split ownership, deliberately: `name` and `command` are ours and must
      // reach existing installs when we rename or re-point a default job (the
      // old `onConflictDoNothing` meant they never did). `schedule`, `enabled`
      // and `config` belong to the user and are only ever set on first insert.
      if (current.name !== job.name || current.command !== job.command) {
        db.update(jobs).set({ name: job.name, command: job.command }).where(eq(jobs.id, job.id)).run();
        updated++;
      }
    }
    if (inserted > 0) log.info("seeded default jobs", { count: inserted });
    if (updated > 0) log.info("refreshed default job name/command", { count: updated });

    // Clean up removed default jobs (delete runs first due to FK constraint)
    for (const id of REMOVED_JOBS) {
      db.delete(jobRuns).where(eq(jobRuns.jobId, id)).run();
      db.delete(jobs).where(eq(jobs.id, id)).run();
    }
  }

  /**
   * Nothing survives a restart mid-run: worker threads die with the process and
   * `cancelling` is an in-memory handshake. Both are failures from the UI's
   * point of view, and the orphan guard in `CommandJob` stops anything that
   * Sidequest still has queued from writing to these rows afterwards.
   */
  function markStaleRunsAsFailed(): void {
    const result = db
      .update(jobRuns)
      .set({ status: "failed", finishedAt: Date.now() })
      .where(inArray(jobRuns.status, [...ACTIVE_RUN_STATUSES]))
      .run();
    if (result.changes > 0) {
      log.info("marked stale runs as failed", { count: result.changes });
    }
  }

  async function startJob(jobId: string): Promise<StartResult> {
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) return { ok: false, reason: "not-found" };

    const runId = randomUUID();
    const now = Date.now();

    // Atomic insert — prevents a race where two concurrent requests both see no
    // running job and both insert. `cancelling` counts as occupying the job:
    // the command is still executing until it unwinds, so letting a second run
    // start would put two live executions on the same job.
    const result = db.run(sql`
    INSERT INTO job_runs (id, job_id, status, log, progress, message, started_at)
    SELECT ${runId}, ${jobId}, 'running', '', 0, '', ${now}
    WHERE NOT EXISTS (
      SELECT 1 FROM job_runs WHERE job_id = ${jobId} AND status IN ('running', 'cancelling')
    )
  `);
    if (result.changes === 0) return { ok: false, reason: "already-running" };

    // Clean up old runs (keep last JOB_RUN_KEEP_PER_JOB). SELECT + DELETE
    // are wrapped in a transaction so a concurrent insert between them
    // can't be deleted by our cleanup (off-by-one retention).
    db.transaction((tx) => {
      const keepIds = tx
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(eq(jobRuns.jobId, jobId))
        .orderBy(desc(jobRuns.startedAt))
        .limit(JOB_RUN_KEEP_PER_JOB)
        .all()
        .map((r) => r.id);

      if (keepIds.length >= JOB_RUN_KEEP_PER_JOB) {
        tx.delete(jobRuns)
          .where(and(eq(jobRuns.jobId, jobId), notInArray(jobRuns.id, keepIds)))
          .run();
      }
    });

    // Internal jobs run in-process without the command pattern.
    if (isInternalJobName(job.command)) {
      await runInternalJob(job, runId, now);
      return { ok: true, runId };
    }

    if (!isCommandName(job.command)) {
      // Only reachable if a user (or an old install) has a job row pointing at a
      // command that no longer exists. Fail the run rather than leaving it stuck.
      const msg = `Unknown command "${job.command}"`;
      db.update(jobRuns)
        .set({ status: "failed", log: msg, message: msg, finishedAt: Date.now() })
        .where(eq(jobRuns.id, runId))
        .run();
      emitEvent("job.failed", `${job.name} failed: ${msg}`, { jobId: job.id, runId });
      log.error("job points at an unknown command", { jobId: job.id, command: job.command });
      return { ok: false, reason: "unknown-command", runId };
    }

    const descriptor = COMMANDS[job.command];
    log.info("enqueueing command", { job: job.name, command: job.command, lane: descriptor.lane });
    const { Sidequest } = await import("sidequest");
    const { CommandJob } = await import("./sidequest/job.ts");
    await Sidequest.build(CommandJob)
      .queue(descriptor.lane)
      .enqueue(job.command, runId, JSON.stringify(job.config ?? {}), job.name, job.id);

    return { ok: true, runId };
  }

  /**
   * Run an internal job inline with a real `JobContext`, so it logs, reports
   * progress, and cancels like every other job instead of being a special case
   * that silently ignored all three.
   */
  async function runInternalJob(job: Job, runId: string, startedAt: number): Promise<void> {
    // Widened to the interface: `as const satisfies` narrows each entry to its
    // literal shape, which loses the optional `quiet` on the ones that omit it.
    const descriptor: InternalJobDescriptor = internalJobs[job.command as InternalJobName];
    const jobLog = log.child({ job: job.name, command: job.command, runId });
    const controller = new AbortController();
    internalControllers.set(runId, controller);

    // Log is buffered and written once at the end, unlike `CommandJob`'s 500ms
    // streaming flush. Deliberate: internal jobs are sub-second, so streaming
    // would cost a write per job for output nobody can read that fast. Progress
    // *does* write through, because `purge-runs` has a visible second phase.
    let buffer = "";
    const ctx: JobContext = deriveJobContext(deps.scope, {
      log: (...args: unknown[]) => {
        buffer += args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
      },
      progress: (current: number, total: number, message: string) => {
        db.update(jobRuns)
          .set({ progress: total > 0 ? Math.min(current / total, 1) : 0, message })
          .where(eq(jobRuns.id, runId))
          .run();
      },
      signal: controller.signal,
    });

    jobLog.debug("running internal job");
    try {
      // Anything this job writes to config or to a rule is attributed to the
      // job, not to whoever happened to press Run. `runAsActor` covers the
      // awaits inside, which a plain assignment would not.
      const output = await runAsActor({ source: `job:${job.command}`, username: "" }, () => descriptor.run(ctx));
      const text = buffer + output;

      // Re-read before the terminal write: `cancelRun` may have moved us to
      // `cancelling` while the handler was running, and clobbering that with
      // `completed` is what made cancellation meaningless for internal jobs.
      if (isCancelling(runId)) {
        finishInternalCancelled(runId, text);
        jobLog.info("cancelled");
        return;
      }
      // Same supersede guard `CommandJob` has: the watchdog may have force-failed
      // this run while we were awaiting, and turning that reported failure back
      // into a success would leave a `job.failed` event contradicting the row.
      if (isRunTerminal(runId)) {
        jobLog.warn("finished after the run was already ended elsewhere; leaving its status alone");
        return;
      }

      db.update(jobRuns)
        .set({ status: "completed", log: text, progress: 1, message: output, finishedAt: Date.now() })
        .where(eq(jobRuns.id, runId))
        .run();

      // Quiet jobs (healthcheck, every 60s) only announce themselves when the
      // outcome text actually changes. The health domain still emits its own
      // `health.*` events for the transitions that matter.
      if (!descriptor.quiet || outcomeChanged(job.id, runId, output)) {
        emitEvent("job.completed", `${job.name} completed in ${formatDuration(Date.now() - startedAt)}`, {
          jobId: job.id,
          runId,
        });
      }
      jobLog.debug("completed", { output });
    } catch (err) {
      const msg = errorMessage(err);
      if (isCancelling(runId)) {
        finishInternalCancelled(runId, buffer + msg);
        jobLog.info("cancelled");
        return;
      }
      if (isRunTerminal(runId)) {
        jobLog.warn("failed after the run was already ended elsewhere; leaving its status alone");
        return;
      }
      db.update(jobRuns)
        .set({ status: "failed", log: buffer + msg, message: msg, finishedAt: Date.now() })
        .where(eq(jobRuns.id, runId))
        .run();
      // Failures always emit, quiet or not.
      emitEvent("job.failed", `${job.name} failed: ${msg}`, { jobId: job.id, runId });
      jobLog.error("failed", { err: msg });
    } finally {
      internalControllers.delete(runId);
      cancelRequestedAt.delete(runId);
    }
  }

  function isCancelling(runId: string): boolean {
    const row = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
    return row?.status === "cancelling" || row?.status === "cancelled";
  }

  /** Has something else (the watchdog) already ended this run? */
  function isRunTerminal(runId: string): boolean {
    const row = db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
    return !!row && isTerminalStatus(row.status);
  }

  function finishInternalCancelled(runId: string, text: string): void {
    // Guarded like every other terminal write on this path. Not reachable today
    // — callers only get here when the status is already `cancelling` — but the
    // watchdog can force-fail a `cancelling` run out from under us, and being
    // the one write that could clobber that is not a property worth keeping.
    if (isRunTerminal(runId)) return;
    db.update(jobRuns)
      .set({ status: "cancelled", log: text, message: "Cancelled", finishedAt: Date.now() })
      .where(eq(jobRuns.id, runId))
      .run();
  }

  /** Did this quiet job produce a different outcome than its previous run? */
  function outcomeChanged(jobId: string, runId: string, output: string): boolean {
    const previous = db
      .select({ id: jobRuns.id, message: jobRuns.message })
      .from(jobRuns)
      .where(eq(jobRuns.jobId, jobId))
      .orderBy(desc(jobRuns.startedAt))
      .limit(2)
      .all()
      .find((r) => r.id !== runId);
    return previous?.message !== output;
  }

  /**
   * Request cancellation. This is only the *request* — the run stays in
   * `cancelling` (with `finishedAt` still null) until the command actually
   * unwinds and writes the terminal `cancelled`, so the displayed duration is
   * the time really spent rather than the time-to-cancel, and no second run can
   * start behind a still-executing one.
   */
  function cancelRun(runId: string): boolean {
    const run = db.select({ id: jobRuns.id, status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, runId)).get();
    if (!run || run.status !== "running") return false;

    db.update(jobRuns).set({ status: "cancelling" }).where(eq(jobRuns.id, runId)).run();
    cancelRequestedAt.set(runId, Date.now());
    // Command jobs notice via their status poll; internal jobs run in this
    // process and are aborted directly.
    internalControllers.get(runId)?.abort();
    log.info("cancellation requested", { runId });

    return true;
  }

  /**
   * Force-fail runs that have outlived their budget, or that have sat in
   * `cancelling` past the grace period.
   *
   * This is the layer that recovers the UI (and unblocks the queue) when a
   * worker thread is genuinely wedged — the in-run deadline in `CommandJob`
   * cannot help there, because aborting a signal doesn't interrupt a thread
   * stuck in a syscall.
   */
  /**
   * The wall-clock budget for whatever this job runs, or null if the command
   * isn't one we know about (in which case there is nothing to enforce — the
   * run will already have been failed at start).
   */
  function runBudgetMs(command: string): number | null {
    if (isCommandName(command)) return COMMANDS[command].timeoutMs;
    if (isInternalJobName(command)) return (internalJobs[command] as InternalJobDescriptor).timeoutMs;
    return null;
  }

  function sweepStuckRuns(now = Date.now()): number {
    const active = db
      .select({
        id: jobRuns.id,
        jobId: jobRuns.jobId,
        status: jobRuns.status,
        startedAt: jobRuns.startedAt,
        command: jobs.command,
        name: jobs.name,
      })
      .from(jobRuns)
      .innerJoin(jobs, eq(jobs.id, jobRuns.jobId))
      .where(inArray(jobRuns.status, [...ACTIVE_RUN_STATUSES]))
      .all();

    let failed = 0;
    for (const run of active) {
      let reason: string | null = null;

      if (run.status === "cancelling") {
        const requestedAt = cancelRequestedAt.get(run.id) ?? run.startedAt;
        if (now - requestedAt > JOB_CANCELLING_GRACE_MS) {
          reason = `Cancellation did not complete within ${formatDuration(JOB_CANCELLING_GRACE_MS)}`;
        }
      } else {
        // Internal jobs are swept too. They never pass through `CommandJob`, so
        // they have no in-run deadline at all — this is their only backstop, and
        // without it a wedged `healthcheck` would occupy its job forever and
        // healthcheck would silently never run again.
        //
        // Be honest about the reach, in the same register as `CommandJob`'s
        // deadline comment: internal jobs run on the main event loop and so does
        // this timer, so a wedge inside *synchronous* work blocks the sweep too.
        // (`better-sqlite3` is entirely synchronous, which is most of what
        // `purge-runs` does.) This covers async stalls — a fetch that never
        // settles, a promise that never resolves — which is the common case.
        const budgetMs = runBudgetMs(run.command);
        if (budgetMs !== null && now > run.startedAt + budgetMs + JOB_TIMEOUT_GRACE_MS * 2) {
          reason = `Exceeded its ${formatDuration(budgetMs)} budget and did not unwind`;
        }
      }
      if (!reason) continue;

      // Actually try to stop it before declaring it dead. For an internal job the
      // AbortController is right here in this process — unlike a command job's
      // worker thread, which we genuinely cannot interrupt. Skipping this would
      // free the "already running" guard while the handler kept going, so the
      // next cron tick would start a second concurrent execution on top of the
      // first one that never stopped.
      const controller = internalControllers.get(run.id);
      if (controller) {
        controller.abort();
        internalControllers.delete(run.id);
        log.warn("aborted a wedged internal job", { runId: run.id, job: run.name });
      }

      db.update(jobRuns)
        .set({
          status: "failed",
          log: sql`${jobRuns.log} || ${`\n[watchdog] ${reason}. Marking the run as failed.\n`}`,
          message: reason,
          // Recorded structurally as well as in the log: "Tinkerbell gave up on
          // this run" and "this run threw" want to read differently in the UI,
          // and grepping a multi-megabyte log for `[watchdog]` is not a way to
          // tell them apart.
          failureKind: run.status === "cancelling" ? "cancel-timeout" : "watchdog",
          finishedAt: now,
        })
        .where(eq(jobRuns.id, run.id))
        .run();
      cancelRequestedAt.delete(run.id);
      emitEvent("job.failed", `${run.name} failed: ${reason}`, { jobId: run.jobId, runId: run.id });
      log.error("watchdog force-failed a stuck run", { runId: run.id, job: run.name, reason });
      failed++;
    }
    return failed;
  }

  function startWatchdog(): void {
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = setInterval(() => {
      try {
        sweepStuckRuns();
        // Rule runs have no deadline of their own — a rule may legitimately take
        // an hour. What they do have is a heartbeat, so the question here is
        // "did the executor stop existing?", not "is this taking too long?".
        const abandoned = sweepStuckRuleRuns();
        if (abandoned > 0) log.warn("failed abandoned rule runs", { count: abandoned });
      } catch (err) {
        log.error("watchdog sweep failed", { err: errorMessage(err) });
      }
    }, JOB_WATCHDOG_INTERVAL_MS);
    // Never hold the process open on the watchdog alone.
    watchdogTimer.unref();
  }

  function updateJob(
    jobId: string,
    updates: { schedule?: string; enabled?: boolean; config?: Record<string, unknown> },
  ): void {
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) throw new Error(`Job "${jobId}" not found`);
    // Snapshotted before any of the three writes below, because `job` is
    // mutated in place as they go — `scheduleCron` needs the updated object.
    const before = { schedule: job.schedule, enabled: job.enabled, config: job.config };

    if (updates.schedule !== undefined) {
      // Validate cron expression (throws if invalid)
      if (updates.schedule) {
        new Cron(updates.schedule);
      }
      db.update(jobs).set({ schedule: updates.schedule }).where(eq(jobs.id, jobId)).run();
      job.schedule = updates.schedule;
    }

    if (updates.enabled !== undefined) {
      const val = updates.enabled ? 1 : 0;
      db.update(jobs).set({ enabled: val }).where(eq(jobs.id, jobId)).run();
      job.enabled = val;
    }

    if (updates.config !== undefined) {
      db.update(jobs).set({ config: updates.config }).where(eq(jobs.id, jobId)).run();
    }

    // One row for the whole call, not one per field: "moved Cleanup to 5am and
    // turned it on" is a single thing somebody did, and splitting it into three
    // log entries would make a two-field edit look like an incident.
    recordChange({
      entity: "job",
      entityId: jobId,
      action: "update",
      before,
      after: {
        schedule: updates.schedule ?? before.schedule,
        enabled: updates.enabled === undefined ? before.enabled : updates.enabled ? 1 : 0,
        config: updates.config ?? before.config,
      },
    });

    // Reschedule cron
    scheduleCron(job);
  }

  async function initJobs(): Promise<void> {
    // Wire startJob into the cron-trigger callback before any schedule
    // can fire. See schedule.ts for the dependency-inversion shape.
    migrateCleanupBudgetKey();
    seedDefaultJobs();
    seedDefaultRules();
    markStaleRunsAsFailed();
    markStaleStressTestsAsFailed();
    // Rule runs die with their process for the same reasons job runs do —
    // whether they were started from the Rules page or by a Generate job.
    const staleRuleRuns = markStaleRuleRunsAsFailed();
    if (staleRuleRuns > 0) log.info("marked stale rule runs as failed", { count: staleRuleRuns });
    await startSidequest();
    startCronSchedules({ catchUp: true });
    startWatchdog();

    // Pick up anything the last process queued and didn't get to. Rule runs that
    // were *executing* were just failed above; these were only ever waiting, and
    // nothing else will ask for them again — the cron spends its occurrence when
    // it queues, not when the rule runs.
    if (hasQueuedRuleWork()) {
      log.info("draining rule work left over from the last run");
      scheduleRuleDrain();
    }
  }

  return { startJob, cancelRun, sweepStuckRuns, updateJob, initJobs };
});
