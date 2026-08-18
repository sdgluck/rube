/**
 * Durable per-execution records for rule runs and tests.
 *
 * Replaces an in-memory `Map` of progress that only the API process could see.
 * That map made a run invisible to every other tab, to the Sidequest worker
 * thread where the nightly Generate job runs its rules, and to the same tab one
 * reload later — so the longest runs, the ones worth watching, were exactly the
 * ones that vanished. SQLite is the one thing all three contexts share.
 *
 * The row is the authority. Cancellation is a status write that the executor
 * notices; the executor owns every terminal write. That is the same contract
 * `packages/jobs` uses for `job_runs`, and it is what lets a run be cancelled
 * from a process that isn't running it.
 */

import { type Scope } from "@tinkerbell/container";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import { ruleRuns, rules, type Db } from "@tinkerbell/db";
import { deriveJobContext, errorMessage, type JobContext } from "@tinkerbell/core";
import { ACTIVE_RULE_RUN_STATUSES, isRuleRunTerminal, type RuleRunStatus } from "./statuses.ts";
import type { TestFunnelSection } from "./test-results.ts";
import {
  RULE_RUN_CANCEL_POLL_MS,
  RULE_RUN_FLUSH_INTERVAL_MS,
  RULE_RUN_HEARTBEAT_TIMEOUT_MS,
  RULE_RUN_KEEP_PER_RULE,
  RULE_RUN_LOG_MAX_BYTES,
  RULE_RUN_LOG_TAIL_BYTES,
} from "./limits.ts";

export type RuleRunPhase = "run" | "test";
/**
 * Why this run happened.
 *
 * "job" is the nightly batch, which owns its rules directly. Everything else
 * arrives through the rule queue, and the reason is recorded because it is the
 * first question asked of a run nobody remembers starting — a rule that rebuilt
 * itself at 14:20 was either on a cron, listening for something, or standing
 * behind another rule, and the run list could not previously tell you which.
 */
export type RuleRunTrigger =
  | "manual"
  | "job"
  | "cron"
  | "chain"
  | "item-added"
  | "item-watched"
  | "item-removed"
  | "request-fulfilled";

export interface RuleRunSummary {
  id: string;
  ruleId: string;
  phase: RuleRunPhase;
  trigger: RuleRunTrigger;
  jobRunId: string | null;
  status: string;
  progress: number;
  message: string;
  collectionCount: number | null;
  itemCount: number | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /**
   * Whether this run recorded a clause-by-clause funnel.
   *
   * A flag rather than the payload: this summary is polled once a second
   * while a run is live, and the funnel is written once at the very end. The
   * list needs to know a diagnosis exists; only the row you expand needs to
   * know what it says.
   */
  hasFunnel: boolean;
}

/** A summary plus the rule's name, for views that aren't already rule-scoped. */
export interface ActiveRuleRun extends RuleRunSummary {
  ruleName: string;
}

export interface RuleRunOutcome {
  status: "ok" | "error" | "cancelled";
  collectionCount?: number;
  itemCount?: number;
  error?: string;
  /**
   * One line saying what happened, for a run that finished without doing
   * anything: out of season, owned by its own cron, no matching libraries, no
   * LLM. All of those record `ok` — nothing went wrong — which left the run list
   * unable to tell "ran and matched nothing" from "did not run at all". The
   * terminal vocabulary stays three words; this says which of them this was.
   */
  message?: string;
}

export interface RuleRunHandle {
  runId: string;
  /** Aborts when the parent signal aborts *or* the row turns `cancelling`. */
  ctx: JobContext;
  /** True once a cancellation has been seen for this run. */
  cancelRequested: () => boolean;
  /** Write the terminal status, flush the log, and stop all timers. */
  finish: (outcome: RuleRunOutcome) => void;
}

const SUMMARY_COLUMNS = {
  id: ruleRuns.id,
  ruleId: ruleRuns.ruleId,
  phase: sql<RuleRunPhase>`${ruleRuns.phase}`,
  trigger: sql<RuleRunTrigger>`${ruleRuns.trigger}`,
  jobRunId: ruleRuns.jobRunId,
  status: ruleRuns.status,
  progress: ruleRuns.progress,
  message: ruleRuns.message,
  collectionCount: ruleRuns.collectionCount,
  itemCount: ruleRuns.itemCount,
  error: ruleRuns.error,
  startedAt: ruleRuns.startedAt,
  updatedAt: ruleRuns.updatedAt,
  finishedAt: ruleRuns.finishedAt,
  hasFunnel: sql<boolean>`${ruleRuns.funnel} IS NOT NULL`,
};

// ── Creating and activating ──────────────────────────────────────────────

export interface CreateRuleRunInput {
  ruleId: string;
  phase: RuleRunPhase;
  trigger: RuleRunTrigger;
  jobRunId?: string | null;
  /** What to show before the run starts producing its own messages. */
  message?: string;
}

export interface ActivateOptions {
  /** The executor's own signal — a job's abort, or the router's controller. */
  signal?: AbortSignal;
  /** Mirror every log line somewhere else (the parent job's log). */
  tee?: (line: string) => void;
  /** Prefix for the console mirror, e.g. "[run-rule]". */
  consolePrefix?: string;
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export interface RuleRunTally {
  count: number;
  lastRunId: string | null;
}

export type { RuleRunStatus };

export interface RunsDeps {
  db: Db;
  /**
   * The scope a rule run's own `JobContext` belongs to.
   *
   * A rule run is a leaf of a job run, so it shares the scope rather than
   * opening one: it has nothing scoped of its own, and disposing it separately
   * would be a lie about its lifetime.
   */
  scope: Scope;
}
export function createRuns(deps: RunsDeps) {
  /**
   * Live handles in *this* process, so a cancel arriving here aborts instantly
   * instead of waiting for the run to poll its own row. The row remains the
   * cross-process path; this is a shortcut, never the only route.
   */
  const liveHandles = new Map<string, { abort: () => void }>();

  const { db } = deps;

  /** Insert a `queued` row and return its id. Nothing executes yet. */
  function createRuleRun(input: CreateRuleRunInput): string {
    const id = randomUUID();
    const now = Date.now();
    db.insert(ruleRuns)
      .values({
        id,
        ruleId: input.ruleId,
        phase: input.phase,
        trigger: input.trigger,
        jobRunId: input.jobRunId ?? null,
        status: "queued",
        message: input.message ?? "Queued…",
        startedAt: now,
        updatedAt: now,
      })
      .run();
    pruneRuleRunsForRule(input.ruleId);
    return id;
  }

  /**
   * Take a `queued` row into `running` and return the handle that owns it.
   *
   * Returns null when the row is gone or is no longer queued — a run cancelled
   * while it waited its turn, or one already claimed. Callers must treat null as
   * "don't execute": it is the same orphan guard `CommandJob` applies before
   * touching Plex.
   */
  function activateRuleRun(runId: string, options: ActivateOptions = {}): RuleRunHandle | null {
    const claimed = db
      .update(ruleRuns)
      .set({ status: "running", startedAt: Date.now(), updatedAt: Date.now(), message: "Starting…" })
      .where(and(eq(ruleRuns.id, runId), eq(ruleRuns.status, "queued")))
      .run();
    if (claimed.changes === 0) return null;
    return attachHandle(runId, options);
  }

  /** Create and activate in one step, for executors with no queue in front. */
  function startRuleRun(input: CreateRuleRunInput & ActivateOptions): RuleRunHandle {
    const { signal, tee, consolePrefix, ...create } = input;
    const runId = createRuleRun(create);
    // The row was just inserted as `queued` and nothing else has its id yet, so
    // the claim cannot fail; the non-null assertion is on that, not on optimism.
    return activateRuleRun(runId, { signal, tee, consolePrefix })!;
  }

  function attachHandle(runId: string, options: ActivateOptions): RuleRunHandle {
    const { signal: parentSignal, tee, consolePrefix } = options;
    const controller = new AbortController();
    let cancelRequested = false;
    let finished = false;

    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    // ── Buffered log, appended rather than rewritten ────────────────────────
    // `log = log || ?` keeps the write proportional to the new text. A
    // read-modify-write would be quadratic in log size, and a run producing a
    // thousand collections produces a lot of log.
    let logBuffer = "";
    let writtenBytes = 0;
    let capped = false;
    let tailBuffer = "";
    let suppressedLines = 0;
    let progress = 0;
    let message = "Starting…";
    let lastFlushedProgress = -1;
    let lastFlushedMessage: string | null = null;

    function flush(): void {
      if (logBuffer.length === 0 && progress === lastFlushedProgress && message === lastFlushedMessage) {
        // Nothing new to say, but the heartbeat still has to move: silence is
        // how the watchdog tells a quiet run from a dead one.
        touch();
        return;
      }
      const chunk = logBuffer;
      logBuffer = "";
      try {
        db.update(ruleRuns)
          .set(
            chunk.length > 0
              ? { log: sql`${ruleRuns.log} || ${chunk}`, progress, message, updatedAt: Date.now() }
              : { progress, message, updatedAt: Date.now() },
          )
          .where(eq(ruleRuns.id, runId))
          .run();
        writtenBytes += Buffer.byteLength(chunk);
        lastFlushedProgress = progress;
        lastFlushedMessage = message;
      } catch {
        // Put the chunk back so a transient lock doesn't lose log lines; the
        // next tick is half a second away.
        logBuffer = chunk + logBuffer;
      }
    }

    function touch(): void {
      try {
        db.update(ruleRuns).set({ updatedAt: Date.now() }).where(eq(ruleRuns.id, runId)).run();
      } catch {
        // A missed heartbeat is recoverable; the next tick writes one.
      }
    }

    /** Final chunk: the truncation marker plus whatever tail was kept. */
    function finalize(): void {
      if (capped) {
        logBuffer +=
          `\n… log truncated at ${Math.round(RULE_RUN_LOG_MAX_BYTES / (1024 * 1024))} MB; ` +
          `${suppressedLines} further line(s) suppressed. Tail follows.\n` +
          tailBuffer;
        capped = false;
        tailBuffer = "";
      }
      flush();
    }

    const ctx: JobContext = deriveJobContext(deps.scope, {
      signal: controller.signal,
      log: (...args: unknown[]) => {
        const line = args.map(formatLogArg).join(" ");
        const text = line + "\n";
        if (consolePrefix) console.log(consolePrefix, line);
        tee?.(line);
        const trimmed = line.trim();
        if (trimmed) message = trimmed;

        if (capped) {
          suppressedLines++;
          tailBuffer += text;
          if (tailBuffer.length > RULE_RUN_LOG_TAIL_BYTES) {
            tailBuffer = tailBuffer.slice(tailBuffer.length - RULE_RUN_LOG_TAIL_BYTES);
          }
          return;
        }
        logBuffer += text;
        if (writtenBytes + Buffer.byteLength(logBuffer) >= RULE_RUN_LOG_MAX_BYTES) capped = true;
      },
      progress: (current: number, total: number, msg: string) => {
        progress = total > 0 ? Math.min(current / total, 1) : 0;
        message = msg;
      },
    });

    const flushTimer = setInterval(flush, RULE_RUN_FLUSH_INTERVAL_MS);
    flushTimer.unref?.();

    // The cross-process half of cancellation: whoever wrote `cancelling` may be
    // in another process entirely, so the executor watches its own row.
    const cancelTimer = setInterval(() => {
      try {
        const row = db.select({ status: ruleRuns.status }).from(ruleRuns).where(eq(ruleRuns.id, runId)).get();
        if (!row || row.status === "cancelling" || row.status === "cancelled") {
          cancelRequested = true;
          controller.abort();
        }
      } catch {
        // Poll failures are transient; the next tick tries again.
      }
    }, RULE_RUN_CANCEL_POLL_MS);
    cancelTimer.unref?.();

    liveHandles.set(runId, {
      abort: () => {
        cancelRequested = true;
        controller.abort();
      },
    });

    function stop(): void {
      clearInterval(flushTimer);
      clearInterval(cancelTimer);
      liveHandles.delete(runId);
      if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    }

    return {
      runId,
      ctx,
      cancelRequested: () => cancelRequested,
      finish: (outcome: RuleRunOutcome) => {
        if (finished) return;
        finished = true;
        if (outcome.status === "ok") progress = 1;
        if (outcome.error) ctx.log(`\nError: ${outcome.error}`);
        finalize();
        stop();
        try {
          // The watchdog may have force-failed this run while it was wedged.
          // Don't flip a run the user was told had failed back into a success.
          const current = db.select({ status: ruleRuns.status }).from(ruleRuns).where(eq(ruleRuns.id, runId)).get();
          if (!current || isRuleRunTerminal(current.status)) return;
          db.update(ruleRuns)
            .set({
              status: outcome.status,
              ...(outcome.message ? { message: outcome.message } : {}),
              progress: outcome.status === "ok" ? 1 : progress,
              collectionCount: outcome.collectionCount ?? null,
              itemCount: outcome.itemCount ?? null,
              error: outcome.error ?? null,
              finishedAt: Date.now(),
              updatedAt: Date.now(),
            })
            .where(eq(ruleRuns.id, runId))
            .run();
        } catch (err) {
          console.error("[rule-runs] failed to write terminal status", errorMessage(err));
        }
      },
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The run to attach to when someone presses Run on a rule that is already
   * going. Pressing Run twice should join the run in progress, not start a
   * second one. Two runs of one rule interleave their writes to the same
   * collections, and before reconciling landed they produced outright duplicates
   * — both would delete, both would create, and Plex kept both sets.
   */
  function findActiveRuleRun(ruleId: string, phase?: RuleRunPhase): RuleRunSummary | null {
    const where = phase
      ? and(
          eq(ruleRuns.ruleId, ruleId),
          eq(ruleRuns.phase, phase),
          inArray(ruleRuns.status, [...ACTIVE_RULE_RUN_STATUSES]),
        )
      : and(eq(ruleRuns.ruleId, ruleId), inArray(ruleRuns.status, [...ACTIVE_RULE_RUN_STATUSES]));
    return db.select(SUMMARY_COLUMNS).from(ruleRuns).where(where).orderBy(desc(ruleRuns.startedAt)).get() ?? null;
  }

  /**
   * Runs waiting their turn, oldest first — the rule queue's backlog.
   *
   * Oldest first because a queue that ran newest-first would starve whatever was
   * enqueued during a busy stretch, and the batch enqueues its whole rule set at
   * once. Ordering *within* the drain is the drainer's business: it has the
   * dependency ranks, which this query has no business knowing about.
   */
  function getQueuedRuleRuns(phase: RuleRunPhase = "run"): ActiveRuleRun[] {
    return db
      .select({ ...SUMMARY_COLUMNS, ruleName: rules.name })
      .from(ruleRuns)
      .innerJoin(rules, eq(rules.id, ruleRuns.ruleId))
      .where(and(eq(ruleRuns.status, "queued"), eq(ruleRuns.phase, phase)))
      .orderBy(ruleRuns.startedAt)
      .all();
  }

  function getActiveRuleRuns(): ActiveRuleRun[] {
    return db
      .select({ ...SUMMARY_COLUMNS, ruleName: rules.name })
      .from(ruleRuns)
      .innerJoin(rules, eq(rules.id, ruleRuns.ruleId))
      .where(inArray(ruleRuns.status, [...ACTIVE_RULE_RUN_STATUSES]))
      .orderBy(desc(ruleRuns.startedAt))
      .all();
  }

  function getRuleRuns(ruleId: string, options: { limit?: number; phase?: RuleRunPhase } = {}): RuleRunSummary[] {
    const { limit = 50, phase } = options;
    return db
      .select(SUMMARY_COLUMNS)
      .from(ruleRuns)
      .where(phase ? and(eq(ruleRuns.ruleId, ruleId), eq(ruleRuns.phase, phase)) : eq(ruleRuns.ruleId, ruleId))
      .orderBy(desc(ruleRuns.startedAt))
      .limit(limit)
      .all();
  }

  /**
   * Run metadata without the log. The UI polls this once a second while a run is
   * live; re-serialising a multi-megabyte log every second is precisely the cost
   * `getRuleRunLog` exists to avoid.
   */
  function getRuleRun(runId: string): RuleRunSummary | null {
    return db.select(SUMMARY_COLUMNS).from(ruleRuns).where(eq(ruleRuns.id, runId)).get() ?? null;
  }

  /**
   * Record where the items went, for a run that produced none.
   *
   * Written after the run's terminal status rather than as part of it: the
   * diagnosis is an explanation of a result that already stands, and a funnel
   * that fails to build must not turn a successful run into a failed one.
   */
  function setRuleRunFunnel(runId: string, funnel: TestFunnelSection[]): void {
    db.update(ruleRuns).set({ funnel }).where(eq(ruleRuns.id, runId)).run();
  }

  /** The stored funnel, or null for the overwhelming majority of runs. */
  function getRuleRunFunnel(runId: string): TestFunnelSection[] | null {
    const row = db.select({ funnel: ruleRuns.funnel }).from(ruleRuns).where(eq(ruleRuns.id, runId)).get();
    return (row?.funnel as TestFunnelSection[] | null | undefined) ?? null;
  }

  /** A slice of a run's log from `offset`, in codepoints (what SQLite counts). */
  function getRuleRunLog(runId: string, offset = 0): { chunk: string; nextOffset: number; size: number } | null {
    const from = Math.max(0, Math.floor(offset));
    const row = db
      .select({
        // substr() is 1-indexed, and counts characters.
        chunk: sql<string>`substr(${ruleRuns.log}, ${from + 1})`,
        size: sql<number>`length(${ruleRuns.log})`,
      })
      .from(ruleRuns)
      .where(eq(ruleRuns.id, runId))
      .get();
    if (!row) return null;
    const chunk = row.chunk ?? "";
    // Spread iterates codepoints, matching how SQLite counted `size`.
    return { chunk, nextOffset: from + [...chunk].length, size: row.size ?? 0 };
  }

  /**
   * The latest runs across every rule, newest first — the Jobs dashboard's
   * recent-activity list. Job-triggered runs are the caller's to filter: on that
   * dashboard the parent job run already stands for them.
   */
  function getRecentRuleRuns(limit = 20): ActiveRuleRun[] {
    return db
      .select({ ...SUMMARY_COLUMNS, ruleName: rules.name })
      .from(ruleRuns)
      .innerJoin(rules, eq(rules.id, ruleRuns.ruleId))
      .orderBy(desc(ruleRuns.startedAt))
      .limit(limit)
      .all();
  }

  function getRuleRunsForJobRun(jobRunId: string): ActiveRuleRun[] {
    return db
      .select({ ...SUMMARY_COLUMNS, ruleName: rules.name })
      .from(ruleRuns)
      .innerJoin(rules, eq(rules.id, ruleRuns.ruleId))
      .where(eq(ruleRuns.jobRunId, jobRunId))
      .orderBy(desc(ruleRuns.startedAt))
      .all();
  }

  /**
   * Run counts for every rule at once — the rules table renders a Runs column for
   * each row, and one grouped query beats a query per row.
   *
   * Which it now is. It used to group for the counts and then issue a *second*
   * query per rule to resolve the latest run's id, which is the thing the comment
   * says it avoids. And that lookup matched on `startedAt = max(startedAt)`, so two
   * runs of one rule created in the same millisecond — a "run all" burst does
   * exactly that — returned an arbitrary one of them.
   *
   * The tie is now broken by id, which is stable: two runs that started in the
   * same millisecond are genuinely indistinguishable in the data, so the goal is a
   * *consistent* answer rather than a true one — the same run every time the page
   * renders, instead of whichever row the query planner reached first. (`rowid`
   * looks like the honest answer here and isn't: SQLite reuses freed rowids, and
   * `purge-runs` frees them constantly.)
   */
  function getRuleRunCounts(): Record<string, RuleRunTally> {
    const rows = db
      .select({
        ruleId: ruleRuns.ruleId,
        count: sql<number>`count(*)`,
        // The id of the newest run, chosen by (startedAt, id) so a millisecond tie
        // is resolved rather than left to the query planner. SQLite compares the
        // concatenation lexicographically, so `startedAt` is zero-padded to a fixed
        // width — without that, "9" would sort above "10".
        lastRunId: sql<string | null>`substr(max(printf('%020d', ${ruleRuns.startedAt}) || '|' || ${ruleRuns.id}), 22)`,
      })
      .from(ruleRuns)
      .groupBy(ruleRuns.ruleId)
      .all();

    const out: Record<string, RuleRunTally> = {};
    for (const row of rows) {
      out[row.ruleId] = { count: row.count, lastRunId: row.lastRunId ?? null };
    }
    return out;
  }

  // ── Cancellation ─────────────────────────────────────────────────────────

  /**
   * Ask a run to stop.
   *
   * A queued run has no executor to unwind, so it goes straight to `cancelled`.
   * A live one is only marked `cancelling`: the executor owns the terminal write,
   * because only it knows when it has actually stopped touching Plex.
   */
  function requestRuleRunCancel(runId: string): "cancelled" | "cancelling" | null {
    const row = db.select({ status: ruleRuns.status }).from(ruleRuns).where(eq(ruleRuns.id, runId)).get();
    if (!row || isRuleRunTerminal(row.status)) return null;

    if (row.status === "queued") {
      db.update(ruleRuns)
        .set({
          status: "cancelled",
          message: "Cancelled before it started",
          finishedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(and(eq(ruleRuns.id, runId), eq(ruleRuns.status, "queued")))
        .run();
      return "cancelled";
    }

    db.update(ruleRuns).set({ status: "cancelling", updatedAt: Date.now() }).where(eq(ruleRuns.id, runId)).run();
    // Same-process runs don't wait for their next poll.
    liveHandles.get(runId)?.abort();
    return "cancelling";
  }

  // ── Sweeps ───────────────────────────────────────────────────────────────

  /**
   * Fail every *executing* run at boot.
   *
   * No execution survives a restart: the API process's runs die with it, and the
   * worker threads die with theirs. A row left saying `running` would show a
   * spinner forever for work that stopped when the process did.
   *
   * `queued` is deliberately exempt. It used to be swept up with the rest,
   * which was harmless when a queued row lived for the microseconds between
   * `createRuleRun` and the router activating it. It is not harmless now: the
   * rule queue's whole point is that a request outlives the process that made it,
   * and the cron will not ask again — it stamps `lastScheduledAt` when it queues,
   * so the occurrence is spent. Failing those rows would silently drop a night's
   * work on any restart. The queue drains them instead, once `initJobs` is done.
   */
  function markStaleRuleRunsAsFailed(): number {
    const now = Date.now();
    const result = db
      .update(ruleRuns)
      .set({
        status: "error",
        error: "Interrupted — Tinkerbell restarted while this run was in progress.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(inArray(ruleRuns.status, ["running", "cancelling"]))
      .run();
    return result.changes;
  }

  /**
   * Fail runs whose executor stopped heartbeating.
   *
   * Covers a Sidequest worker thread dying without taking the process down —
   * there's no restart to trigger the boot sweep, and the row would otherwise
   * stay `running` until one happened. Queued runs are exempt: they are waiting
   * by design and nothing is heartbeating for them.
   */
  function sweepStuckRuleRuns(now = Date.now()): number {
    const cutoff = now - RULE_RUN_HEARTBEAT_TIMEOUT_MS;
    const result = db
      .update(ruleRuns)
      .set({
        status: "error",
        error: "Stopped reporting progress — the run was abandoned.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(inArray(ruleRuns.status, ["running", "cancelling"]), lt(ruleRuns.updatedAt, cutoff)))
      .run();
    return result.changes;
  }

  /** Delete finished runs older than `cutoff`. Used by the `purge-runs` job. */
  function pruneRuleRuns(cutoff: number): number {
    return db
      .delete(ruleRuns)
      .where(and(notInArray(ruleRuns.status, [...ACTIVE_RULE_RUN_STATUSES]), lt(ruleRuns.startedAt, cutoff)))
      .run().changes;
  }

  /**
   * Keep only the most recent `RULE_RUN_KEEP_PER_RULE` finished runs for a rule.
   *
   * Age-based purging runs weekly; this bounds a rule that is run by hand fifty
   * times in an afternoon. Active runs are never counted or deleted — a run in
   * progress is not history yet.
   */
  function pruneRuleRunsForRule(ruleId: string): void {
    const keep = db
      .select({ startedAt: ruleRuns.startedAt })
      .from(ruleRuns)
      .where(eq(ruleRuns.ruleId, ruleId))
      .orderBy(desc(ruleRuns.startedAt))
      .limit(RULE_RUN_KEEP_PER_RULE)
      .all();
    if (keep.length < RULE_RUN_KEEP_PER_RULE) return;
    const cutoff = keep[keep.length - 1].startedAt;
    db.delete(ruleRuns)
      .where(
        and(
          eq(ruleRuns.ruleId, ruleId),
          lt(ruleRuns.startedAt, cutoff),
          notInArray(ruleRuns.status, [...ACTIVE_RULE_RUN_STATUSES]),
        ),
      )
      .run();
  }

  /** Runs that never finished, for diagnostics and tests. */
  function countUnfinishedRuleRuns(): number {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(ruleRuns)
      .where(isNull(ruleRuns.finishedAt))
      .get();
    return row?.n ?? 0;
  }

  return {
    createRuleRun,
    activateRuleRun,
    startRuleRun,
    findActiveRuleRun,
    getQueuedRuleRuns,
    getActiveRuleRuns,
    getRuleRuns,
    getRuleRun,
    setRuleRunFunnel,
    getRuleRunFunnel,
    getRuleRunLog,
    getRecentRuleRuns,
    getRuleRunsForJobRun,
    getRuleRunCounts,
    requestRuleRunCancel,
    markStaleRuleRunsAsFailed,
    sweepStuckRuleRuns,
    pruneRuleRuns,
    countUnfinishedRuleRuns,
  };
}
