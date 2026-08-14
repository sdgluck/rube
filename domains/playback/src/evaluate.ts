/**
 * Evaluate the `tb.` filter leaves Plex cannot answer.
 *
 * Pure by design — no DB, no Plex client, no config reads. The caller loads
 * `watch_state` for the items Plex returned, resolves the user set, and hands
 * both in. Everything about this feature that can be quietly wrong lives in
 * this file, so it is tested against a table rather than through the job.
 *
 * Two conventions run through all of it:
 *
 *  - **No row means never played.** That is the common case in a fresh
 *    install, not an error, and every predicate has to have an answer for it.
 *  - **"Watched" means a completed play**, i.e. `completedPlays >= 1`. A
 *    started-and-abandoned session counts towards `plays` and nothing else.
 */
import type { SmartFilterLeaf, SmartFilterOp } from "@tinkerbell/plex-smart-filter";
import type { WatchStateRow } from "./store.ts";

export interface LocalEvalContext {
  /**
   * The account ids "everyone" means, already resolved — opted-in users, with
   * or without the owner per `watch_state_all_users_include_owner`.
   *
   * Empty is a legitimate state (nobody synced yet) and must make
   * `tb.watchedByAll` false rather than vacuously true.
   */
  userIds: number[];
  /** Wall clock, for resolving Plex relative date offsets like `-30d`. */
  now: number;
  /**
   * `playback_completion_threshold`. Used as the completion a finished play is
   * known to have reached, for rows written before `max_completion_pct`
   * existed and for backfilled history that carries no offset.
   */
  completionThreshold: number;
}

const DAY_MS = 86_400_000;

/** The fields this module implements. Kept in step with `LOCAL_FIELD_DEFS`. */
export const LOCAL_EVAL_FIELDS = [
  "tb.watchedByAll",
  "tb.watchedByNobody",
  "tb.watchedBy",
  "tb.playCount",
  "tb.lastPlayedAt",
  "tb.abandonedPct",
] as const;

function isWatched(row: WatchStateRow): boolean {
  return row.completedPlays >= 1;
}

/**
 * How far this user is known to have got.
 *
 * `maxCompletionPct` is authoritative when it is set, but two kinds of row
 * carry a completed play with no recorded offset: those written before the
 * column existed, and backfilled Plex history (which reports that a play
 * happened and nothing about how it went). Reading those as 0% would file a
 * finished film under "everyone bounced off this", so a completed play floors
 * the figure at the threshold that made it one.
 */
function completionOf(row: WatchStateRow, threshold: number): number {
  return Math.max(row.maxCompletionPct, isWatched(row) ? threshold : 0);
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function compareNumber(actual: number, op: SmartFilterOp, expected: number): boolean {
  switch (op) {
    case "=":
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    case "<":
      return actual < expected;
    default:
      return false;
  }
}

function compareBoolean(actual: boolean, op: SmartFilterOp, value: string): boolean {
  const expected = value === "1" || value === "true";
  // Plex only ever offers `=` on a boolean, but an imported filter can carry
  // `!=` and the tree round-trips it, so both are honoured.
  return op === "!=" ? actual !== expected : actual === expected;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_SECONDS = /^\d{9,11}$/;
const RELATIVE = /^-(\d+)(d|w|mon|y)$/;

/**
 * Resolve a Plex date filter value to epoch ms, or null if it isn't one.
 *
 * Plex accepts an ISO date, a bare year, epoch seconds, and its own relative
 * offsets (`-30d`, `-2w`, `-3mon`, `-1y`). Normally Plex resolves these; for a
 * local field nothing else will, so the same four forms are handled here.
 */
export function resolveDateValue(value: string, now: number): number | null {
  const rel = value.match(RELATIVE);
  if (rel) {
    const amount = Number(rel[1]);
    switch (rel[2]) {
      case "d":
        return now - amount * DAY_MS;
      case "w":
        return now - amount * 7 * DAY_MS;
      case "mon": {
        const d = new Date(now);
        d.setMonth(d.getMonth() - amount);
        return d.getTime();
      }
      default: {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - amount);
        return d.getTime();
      }
    }
  }
  if (ISO_DATE.test(value)) {
    const t = new Date(`${value}T00:00:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (EPOCH_SECONDS.test(value)) return Number(value) * 1000;
  if (/^\d{4}$/.test(value)) {
    const t = new Date(`${value}-01-01T00:00:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// ─── Predicates ──────────────────────────────────────────────────────────────

/**
 * Whether one item satisfies one local leaf.
 *
 * `rows` is every `watch_state` row for the item, across all users —
 * `undefined` or empty means nobody has ever played it.
 */
export function evaluateLocal(
  leaf: SmartFilterLeaf,
  rows: WatchStateRow[] | undefined,
  ctx: LocalEvalContext,
): boolean {
  const all = rows ?? [];

  switch (leaf.field) {
    case "tb.watchedByAll": {
      // Vacuous truth is a library-deleting bug here: with no users resolved,
      // "everyone has watched everything" is technically true and catastrophic
      // the moment a cleanup rule acts on it.
      const watched = new Set(all.filter(isWatched).map((r) => r.userId));
      const actual = ctx.userIds.length > 0 && ctx.userIds.every((id) => watched.has(id));
      return compareBoolean(actual, leaf.op, leaf.value);
    }

    case "tb.watchedByNobody": {
      // Deliberately not the complement of `watchedByAll`, and not scoped to
      // `ctx.userIds`: an item the excluded owner has finished has been watched
      // by somebody, whatever the rule's definition of "everyone" is.
      return compareBoolean(!all.some(isWatched), leaf.op, leaf.value);
    }

    case "tb.watchedBy": {
      const userId = Number(leaf.value);
      // An unparseable id matches nothing rather than everything.
      if (!Number.isFinite(userId)) return leaf.op === "!=";
      const actual = all.some((r) => r.userId === userId && isWatched(r));
      return compareBoolean(actual, leaf.op, "1");
    }

    case "tb.playCount": {
      const expected = Number(leaf.value);
      if (!Number.isFinite(expected)) return false;
      const total = all.reduce((sum, r) => sum + r.completedPlays, 0);
      return compareNumber(total, leaf.op, expected);
    }

    case "tb.lastPlayedAt": {
      const expected = resolveDateValue(leaf.value, ctx.now);
      if (expected == null) return false;
      const times = all.map((r) => r.lastPlayedAt).filter((t): t is number => t != null);
      // Never played means there is no date to compare, so no comparison holds
      // — including `!=`, which would otherwise sweep in the whole library.
      if (times.length === 0) return false;
      return compareNumber(Math.max(...times), leaf.op, expected);
    }

    case "tb.abandonedPct": {
      const expected = Number(leaf.value);
      if (!Number.isFinite(expected)) return false;
      // "Abandoned below 20%" is a claim about something someone started. An
      // item nobody ever pressed play on sits at 0% and would otherwise match
      // — which is the whole unwatched library, not the bounced-off shelf.
      const started = all.filter((r) => r.plays >= 1);
      if (started.length === 0) return false;
      // Max, not mean: one person giving up ten minutes in says nothing about
      // an item somebody else finished.
      const highest = Math.max(...started.map((r) => completionOf(r, ctx.completionThreshold)));
      return compareNumber(highest * 100, leaf.op, expected);
    }

    default:
      // `ruleConfigSchema` rejects unknown `tb.` fields at save time, so
      // reaching here means a rule bypassed validation. Matching nothing is
      // the safe reading for a filter that may feed a deletion.
      return false;
  }
}
