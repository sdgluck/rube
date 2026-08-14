/**
 * The cleanup candidate ledger.
 *
 * A cleanup rule is a scheduled job that can delete files, so it is built
 * around one rule: **an item is never actioned on the run that first matched
 * it.** A match increments a streak; the action only fires once the streak
 * reaches the rule's `consecutiveRuns`. An item that stops matching loses its
 * row and starts from one next time.
 *
 * That gives three things a single-shot filter cannot. A metadata blip or a
 * half-finished library scan can't delete anything on its own. The queue is
 * inspectable before it acts — the UI reads this table to say "these six films
 * go tomorrow unless you keep them". And once something has been actioned the
 * row stays, which is the audit trail people want the moment they notice a
 * film is gone.
 *
 * Every function here is synchronous better-sqlite3 and safe to call inside a
 * transaction; `recordMatches` opens its own so a crash mid-run cannot leave
 * half the streaks bumped.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { cleanupCandidates, db, rules } from "@tinkerbell/db";

export type CleanupAction = "label" | "collection_only" | "unmonitor" | "delete";

export interface CleanupMatch {
  ratingKey: string;
  sectionId: string;
  title: string;
}

export interface CleanupCandidate {
  ruleId: string;
  ratingKey: string;
  sectionId: string;
  title: string;
  streak: number;
  firstMatchedAt: number;
  lastMatchedAt: number;
  actionedAt: number | null;
  action: string;
  heldUntil: number | null;
}

/** SQLite caps host parameters at 999; a rule can match a whole library. */
const CHUNK = 400;

/**
 * Fold one run's matches into the ledger.
 *
 * Three things happen atomically: items still matching have their streak
 * bumped, items seen for the first time are inserted at 1, and items that
 * stopped matching have their rows dropped so the streak restarts. That last
 * part is the whole safety property — a rule whose filter drifts in and out
 * can never accumulate a streak.
 *
 * Already-actioned rows are left alone. Re-bumping them would let a single
 * item be deleted, re-matched (Plex keeps the metadata around briefly), and
 * counted towards a second action.
 */
export function recordMatches(ruleId: string, matches: CleanupMatch[], now: number = Date.now()): void {
  const seen = new Set(matches.map((m) => m.ratingKey));

  db.transaction(() => {
    const existing = db
      .select({ ratingKey: cleanupCandidates.ratingKey, actionedAt: cleanupCandidates.actionedAt })
      .from(cleanupCandidates)
      .where(eq(cleanupCandidates.ruleId, ruleId))
      .all();

    // Rows that stopped matching. Actioned rows are audit history and stay
    // regardless — they are not "candidates" any more.
    const stale = existing.filter((r) => r.actionedAt == null && !seen.has(r.ratingKey)).map((r) => r.ratingKey);
    for (let i = 0; i < stale.length; i += CHUNK) {
      db.delete(cleanupCandidates)
        .where(
          and(
            eq(cleanupCandidates.ruleId, ruleId),
            inArray(cleanupCandidates.ratingKey, stale.slice(i, i + CHUNK)),
            isNull(cleanupCandidates.actionedAt),
          ),
        )
        .run();
    }

    const actioned = new Set(existing.filter((r) => r.actionedAt != null).map((r) => r.ratingKey));

    for (const match of matches) {
      if (actioned.has(match.ratingKey)) continue;
      db.insert(cleanupCandidates)
        .values({
          ruleId,
          ratingKey: match.ratingKey,
          sectionId: match.sectionId,
          title: match.title,
          streak: 1,
          firstMatchedAt: now,
          lastMatchedAt: now,
        })
        .onConflictDoUpdate({
          target: [cleanupCandidates.ruleId, cleanupCandidates.ratingKey],
          set: {
            streak: sql`${cleanupCandidates.streak} + 1`,
            lastMatchedAt: now,
            // A retitled item shouldn't show its old name in the queue.
            title: match.title,
            sectionId: match.sectionId,
          },
        })
        .run();
    }
  });
}

/**
 * Candidates whose streak has reached the threshold and which nothing is
 * holding back.
 *
 * `limit` is the rule's per-run ceiling. Ordered by longest streak first so a
 * capped run works through the oldest offenders rather than an arbitrary slice
 * that changes every time.
 */
export function dueForAction(
  ruleId: string,
  consecutiveRuns: number,
  limit: number,
  now: number = Date.now(),
): CleanupCandidate[] {
  return db
    .select()
    .from(cleanupCandidates)
    .where(
      and(
        eq(cleanupCandidates.ruleId, ruleId),
        gte(cleanupCandidates.streak, consecutiveRuns),
        isNull(cleanupCandidates.actionedAt),
        // A hold that has expired stops applying, so "keep for 30 days" needs
        // no sweeper job to clean up after itself.
        or(isNull(cleanupCandidates.heldUntil), lte(cleanupCandidates.heldUntil, now)),
      ),
    )
    .orderBy(desc(cleanupCandidates.streak), asc(cleanupCandidates.firstMatchedAt))
    .limit(limit)
    .all();
}

/** Stamp a candidate as done. The row stays as the audit trail. */
export function markActioned(ruleId: string, ratingKey: string, action: CleanupAction, now: number = Date.now()): void {
  db.update(cleanupCandidates)
    .set({ actionedAt: now, action })
    .where(and(eq(cleanupCandidates.ruleId, ruleId), eq(cleanupCandidates.ratingKey, ratingKey)))
    .run();
}

/**
 * Reprieve one item. `untilMs` of `null` clears the hold.
 *
 * Deliberately per-item rather than a rule edit: the queue page's "Keep"
 * button is the affordance someone reaches for when they disagree with one
 * decision, not with the rule.
 */
export function holdCandidate(ruleId: string, ratingKey: string, untilMs: number | null): void {
  db.update(cleanupCandidates)
    .set({ heldUntil: untilMs })
    .where(and(eq(cleanupCandidates.ruleId, ruleId), eq(cleanupCandidates.ratingKey, ratingKey)))
    .run();
}

/** Everything this rule has queued or actioned, newest activity first. */
export function listCandidates(ruleId: string): CleanupCandidate[] {
  return db
    .select()
    .from(cleanupCandidates)
    .where(eq(cleanupCandidates.ruleId, ruleId))
    .orderBy(desc(cleanupCandidates.streak), desc(cleanupCandidates.lastMatchedAt))
    .all();
}

export interface QueuedCandidate extends CleanupCandidate {
  ruleName: string;
  /** From the rule's own config, so the page can say what will happen. */
  consecutiveRuns: number;
  mode: string;
  /** Runs still needed before this one is actioned. 0 = due now. */
  runsRemaining: number;
}

/**
 * The cross-rule queue the `/cleanup` page renders.
 *
 * Joined to `rules` here rather than in the router because the page needs the
 * rule's name and its `consecutiveRuns` to say anything useful about a row,
 * and asking per row would be a query per item.
 */
export function queuedCandidates(opts: { includeActioned?: boolean; limit?: number } = {}): QueuedCandidate[] {
  const rows = db
    .select({
      candidate: cleanupCandidates,
      ruleName: rules.name,
      config: rules.config,
    })
    .from(cleanupCandidates)
    .innerJoin(rules, eq(rules.id, cleanupCandidates.ruleId))
    .where(opts.includeActioned ? undefined : isNull(cleanupCandidates.actionedAt))
    .orderBy(desc(cleanupCandidates.streak), asc(cleanupCandidates.firstMatchedAt))
    .limit(opts.limit ?? 500)
    .all();

  return rows.map(({ candidate, ruleName, config }) => {
    const action = (config as { action?: { consecutiveRuns?: number; mode?: string } } | null)?.action;
    const consecutiveRuns = action?.consecutiveRuns ?? 3;
    return {
      ...candidate,
      ruleName,
      consecutiveRuns,
      mode: action?.mode ?? "",
      runsRemaining: Math.max(0, consecutiveRuns - candidate.streak),
    };
  });
}

/**
 * Queued and actioned counts per rule, for the Rules table.
 *
 * A collection count means nothing for a cleanup rule — it builds one shelf
 * and that's it. "12 queued / 3 removed" is the status someone actually wants.
 */
export function countsByRule(): Map<string, { queued: number; actioned: number }> {
  const rows = db
    .select({
      ruleId: cleanupCandidates.ruleId,
      actioned: sql<number>`sum(case when ${cleanupCandidates.actionedAt} is null then 0 else 1 end)`,
      queued: sql<number>`sum(case when ${cleanupCandidates.actionedAt} is null then 1 else 0 end)`,
    })
    .from(cleanupCandidates)
    .groupBy(cleanupCandidates.ruleId)
    .all();
  return new Map(rows.map((r) => [r.ruleId, { queued: r.queued, actioned: r.actioned }]));
}

/** Queue size for the sidebar badge — items due now or on the next run. */
export function dueSoonCount(): number {
  const rows = queuedCandidates({ limit: 1000 });
  return rows.filter((r) => r.runsRemaining <= 1 && (r.heldUntil == null || r.heldUntil <= Date.now())).length;
}
