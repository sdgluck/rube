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
import { db, playbackSessions } from "@tinkerbell/db";
import { getConfig, MINUTE_MS } from "@tinkerbell/core";

/**
 * The jobs worth deferring: the ones that render, transcode or walk the whole
 * library. Everything else is a handful of queries and finishes long before
 * anyone notices it started.
 *
 * A fixed list rather than a setting. The distinction is a property of what
 * the job does, not a preference, and a per-job checkbox would be twelve more
 * switches to explain in return for a choice nobody has a reason to make
 * differently.
 */
export const DEFERRABLE_JOBS: readonly string[] = [
  "generate",
  "cleanup",
  // Same engine as the two above, plus one Plex read per matched item.
  "metadata",
  "sync-media",
  "sync-collections",
  "overlays",
  "posters-refresh",
  "collection-art",
  "preroll-process",
  "because-you-watched",
  "personalize",
];

export function isDeferrable(jobId: string): boolean {
  return DEFERRABLE_JOBS.includes(jobId);
}

/**
 * How many streams are open right now, according to our own session table.
 *
 * Read locally rather than asking Plex: the playback poller already writes
 * this every 30 seconds, and putting a Plex round-trip in the path of every
 * scheduled job start would make the gate itself a source of load. Worst case
 * the answer is 30 seconds stale, which for "is anyone watching" is fine.
 */
export function openStreamCount(transcodesOnly: boolean): number {
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

/** `HH:MM` → minutes past midnight, or null if it isn't a time. */
export function parseClock(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Is `now` inside the window?
 *
 * A window whose end precedes its start spans midnight, which is the common
 * shape for a maintenance window — 01:00 to 06:00 is easy, but 22:00 to 06:00
 * is what people actually mean by "overnight".
 */
export function isWithinWindow(from: string, to: string, now: Date): boolean {
  const start = parseClock(from);
  const end = parseClock(to);
  // An unparseable window is not a window. Failing open matters here: a typo
  // in a time field should not silently stop every heavy job on the server.
  if (start == null || end == null) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export interface DeferralVerdict {
  /** Why this start is being held, in words the job log can print. */
  reason: string;
  kind: "streaming" | "window";
}

/**
 * Should this scheduled start wait?
 *
 * `null` means go. Callers must only consult this for scheduled starts — see
 * the header.
 */
export function deferralFor(jobId: string, now: Date = new Date()): DeferralVerdict | null {
  if (!isDeferrable(jobId)) return null;

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
export function maxDeferralMs(): number {
  const defer = getConfig("jobs_defer_while_streaming");
  return (defer?.maxWaitMinutes ?? 120) * MINUTE_MS;
}
