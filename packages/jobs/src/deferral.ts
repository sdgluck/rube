import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";
/**
 * Holding heavy work back while the server is doing the thing it exists for.
 *
 * Poster rendering, overlay burn-in and preroll transcodes are CPU and disk
 * against the same box that is serving the stream — and they are scheduled for
 * exactly the hours somebody is likely to be watching. This is the gate that
 * lets those jobs wait for a quiet moment, and a maintenance window that keeps
 * them out of the evening altogether.
 *
 * Two rules the whole design hangs on:
 *
 * - **Scheduled starts only.** A person pressing "Run now" has asked for it
 *   now. Deferring that is how a button comes to look broken.
 * - **There is always a ceiling.** A household that streams every evening
 *   would otherwise push the nightly jobs into never running at all, and a job
 *   that silently stops running is worse than one that competes for CPU.
 */

import { and, isNull, sql } from "drizzle-orm";
import { playbackSessions } from "@tinkerbell/db";
import { minutesOfDay, parseClock, MINUTE_MS } from "@tinkerbell/core";
import { HEAVY_JOB_IDS } from "@tinkerbell/contracts";

/**
 * The jobs worth deferring: the ones that render, transcode or walk the whole
 * library. Everything else is a handful of queries and finishes long before
 * anyone notices it started.
 *
 * A fixed list rather than a setting. The distinction is a property of what
 * the job does, not a preference, and a per-job checkbox would be twelve more
 * switches to explain in return for a choice nobody has a reason to make
 * differently.
 *
 * Declared as `heavy` in contracts' `JOB_SCHEDULE_META`, which the schedule
 * page reads too — so the jobs it warns about starting outside the window are
 * exactly the ones this gate holds back.
 */
export const DEFERRABLE_JOBS: readonly string[] = HEAVY_JOB_IDS;

export function isDeferrable(jobId: string): boolean {
  return DEFERRABLE_JOBS.includes(jobId);
}

// `parseClock` and `minutesOfDay` come from core, which grew the same pair for
// notification quiet hours — the zone-aware half is the part that was missing
// here, and two copies of it is how they came to disagree.
export { parseClock };

export interface DeferralVerdict {
  /** Why this start is being held, in words the job log can print. */
  reason: string;
  kind: "streaming" | "window";
}

export const createDeferral = perDeps(function createDeferral(deps: Pick<Services, "config" | "db">) {
  const { config, db } = deps;
  const { configuredTimezone, getConfig } = config;

  /**
   * How many streams are open right now, according to our own session table.
   *
   * Read locally rather than asking Plex: the playback poller already writes
   * this every 30 seconds, and putting a Plex round-trip in the path of every
   * scheduled job start would make the gate itself a source of load. Worst case
   * the answer is 30 seconds stale, which for "is anyone watching" is fine.
   */
  function openStreamCount(transcodesOnly: boolean): number {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(playbackSessions)
      .where(
        transcodesOnly
          ? and(isNull(playbackSessions.endedAt), sql`${playbackSessions.decision} = 'transcode'`)
          : isNull(playbackSessions.endedAt),
      )
      .get();
    return row?.n ?? 0;
  }

  /**
   * Is `now` inside the window?
   *
   * A window whose end precedes its start spans midnight, which is the common
   * shape for a maintenance window — 01:00 to 06:00 is easy, but 22:00 to 06:00
   * is what people actually mean by "overnight".
   *
   * Read in the configured timezone, like the cron schedules these windows exist
   * to gate. It used to read `now.getHours()`, i.e. the container clock, so a UTC
   * container set to `America/Los_Angeles` enforced "overnight" eight hours out —
   * holding jobs back through the evening and releasing them mid-afternoon.
   *
   * Not `isWithinClockWindow` from core, which returns false for an unparseable
   * window because its callers use it to suppress notifications. Here false means
   * "defer", and a typo in a time field must not silently stop every heavy job on
   * the server, so this one fails open.
   */
  function isWithinWindow(from: string, to: string, now: Date, timezone = configuredTimezone()): boolean {
    const start = parseClock(from);
    const end = parseClock(to);
    if (start == null || end == null) return true;
    const minutes = minutesOfDay(now, timezone);
    if (start === end) return true;
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }

  /**
   * Should this scheduled start wait?
   *
   * `null` means go. Callers must only consult this for scheduled starts — see
   * the header.
   */
  function deferralFor(jobId: string, now: Date = new Date()): DeferralVerdict | null {
    if (!isDeferrable(jobId)) return null;
    return busyVerdict(now);
  }

  /**
   * Should rule work the *server* decided to do wait?
   *
   * `deferralFor` is keyed on a job id, which answers the question for the nightly
   * batch — `generate`, `cleanup` and `metadata` are all deferrable. It has no
   * answer for a rule started by its own cron or by an event trigger, because
   * that work has no job id of its own: it runs inside `rule-schedules`,
   * `playback-poll`, `sync-recently-added` or `seerr-poll`, none of which are in
   * the list. So per-rule crons and every trigger have ignored the maintenance
   * window and the defer-while-streaming setting entirely.
   *
   * That is the wrong answer to the same question, and the way a user hits it is
   * one checkbox: ticking "run this rule on its own schedule" moved it from a
   * gated path to an ungated one. They asked for hourly, not for hourly *and*
   * while somebody is watching something — and `item-watched` is worse still,
   * since it starts work at the one moment a stream is provably open.
   *
   * Same two gates, same ceiling, decided by the kind of work rather than by
   * which job happens to host it.
   */
  function deferralForRuleWork(now: Date = new Date()): DeferralVerdict | null {
    return busyVerdict(now);
  }

  /** The window and streaming gates, without the "is this job deferrable" question. */
  function busyVerdict(now: Date): DeferralVerdict | null {
    const window = getConfig("jobs_maintenance_window");
    if (window?.enabled && !isWithinWindow(window.from, window.to, now)) {
      return { kind: "window", reason: `outside the maintenance window (${window.from}–${window.to})` };
    }

    const defer = getConfig("jobs_defer_while_streaming");
    if (defer?.enabled) {
      const streams = openStreamCount(defer.transcodesOnly);
      if (streams > 0) {
        const what = defer.transcodesOnly ? "transcode" : "stream";
        return {
          kind: "streaming",
          reason: `${streams} ${what}${streams === 1 ? "" : "s"} in progress`,
        };
      }
    }

    return null;
  }

  /** The ceiling, as milliseconds. Read here so both callers agree on it. */
  function maxDeferralMs(): number {
    const defer = getConfig("jobs_defer_while_streaming");
    return (defer?.maxWaitMinutes ?? 120) * MINUTE_MS;
  }

  return { openStreamCount, isWithinWindow, deferralFor, deferralForRuleWork, maxDeferralMs };
});
