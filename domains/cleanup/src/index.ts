/**
 * The cleanup candidate ledger.
 *
 * A cleanup rule is a scheduled job that can delete files, so it is built
 * around one rule: **an item is never actioned on the run that first matched
 * it.** A match increments a streak; the action only fires once the streak
 * reaches the rule's `consecutiveRuns`. An item that stops matching loses its
 * row and starts from one next time.
 *
 * A streak counts *days*, not runs. The number is presented as "three runs in a
 * row" because for the nightly batch they are the same thing, but a rule can
 * also carry triggers that fire every fifteen minutes, a cron of its own, and a
 * "Run now" button — so counting runs meant a threshold of three could be
 * reached in 45 minutes. `recordMatches` therefore advances a row at most once
 * per calendar day, in the configured timezone.
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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  cleanupCandidates,
  cleanupKeepVotes,
  cleanupProtections,
  collectionItems,
  collections,
  jobRuns,
  mediaItems,
  rules,
  type Db,
} from "@tinkerbell/db";
import { localDayKey, DAY_MS, type ConfigStore } from "@tinkerbell/core";
import { token } from "@tinkerbell/container";

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
  /** When a human approved this item, for a rule with `requireApproval`. */
  approvedAt: number | null;
}

/** SQLite caps host parameters at 999; a rule can match a whole library. */
const CHUNK = 400;

/** How stale the local library index may be before cleanup refuses to act. */
export const MAX_INDEX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Note the wording: it stops every *removal*, not every rule. `label` and
 * `collection_only` are deliberately exempt at action time (they take nothing
 * away and are how people try the feature out before trusting it), and the
 * message used to claim otherwise.
 */
export const KILL_SWITCH_REFUSAL =
  "cleanup is disabled globally (Settings → Cleanup). One switch stops every rule from removing anything.";

export type ProtectionKind = "item" | "collection";

export interface Protection {
  id: number;
  kind: string;
  value: string;
  label: string;
  note: string;
  createdAt: number;
}

export interface QueuedCandidate extends CleanupCandidate {
  ruleName: string;
  /** From the rule's own config, so the page can say what will happen. */
  consecutiveRuns: number;
  mode: string;
  /** Runs still needed before this one is actioned. 0 = due now. */
  runsRemaining: number;
  /**
   * Whether a reprieve is still in force.
   *
   * Computed here rather than in the browser: `heldUntil` is a server
   * timestamp, and letting the page compare it against the *viewer's* clock
   * means a skewed machine shows a different queue from the one the engine
   * will act on. The server decides; the page renders what it is told.
   */
  held: boolean;
  /**
   * Bytes this item occupies, or null when that is not known.
   *
   * Null is common and not an error — see the `file_size` column note. The
   * page totals what it knows and says how many it could not account for,
   * because a deletion queue that quietly under-reports its own size is
   * worse than one that admits the gap.
   */
  fileSize: number | null;
  /**
   * Whether a standing protection covers this item.
   *
   * Computed server-side alongside `held` and for the same reason: the page
   * must not be able to disagree with the engine about what is safe.
   */
  isProtected: boolean;
  /**
   * Who has asked, from the portal, for this to stay.
   *
   * Advisory by design — see `recordKeepVote`. The queue shows it so a
   * deletion nobody wanted is a decision somebody made rather than one that
   * simply happened at 4am.
   */
  keepVotes: string[];
  /**
   * Whether this rule holds destructive actions until a human says yes, and
   * whether this item has had that yes.
   *
   * Both on the row rather than looked up per rule in the page: the queue is
   * cross-rule, so "is this waiting on me" is a per-row question with a
   * per-rule answer, and computing it in the browser means the page can
   * disagree with the engine about what is about to happen.
   */
  requiresApproval: boolean;
  approved: boolean;
  /**
   * Whether the rule that queued this is still switched on. A disabled rule
   * never runs, so its queue is history — nothing on it is going anywhere, and
   * anything that warns people has to say so.
   */
  ruleEnabled: boolean;
}

export interface CleanupDeps {
  db: Db;
  config: ConfigStore;
  /** The composition root's clock, so a pinned test clock reaches the cap readout. */
  now: () => number;
}
export function createCleanup(deps: CleanupDeps) {
  const { db } = deps;
  const { getConfig, configuredTimezone } = deps.config;

  /** Age of the newest successful `sync-media` run, or null if there isn't one. */
  function indexAgeMs(now: number): number | null {
    const row = db
      .select({ finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobId, "sync-media"), eq(jobRuns.status, "completed")))
      .orderBy(desc(jobRuns.finishedAt))
      .limit(1)
      .get();
    return row?.finishedAt == null ? null : now - row.finishedAt;
  }

  /**
   * Refusals that hold for the whole install regardless of what matched — the
   * global switch and a stale library index.
   *
   * Lives here rather than in the job that acts on it because it is not only the
   * engine's question. Everything that *tells someone a deletion is coming* has
   * to ask it too: the portal's "leaving soon" list, the sidebar badge and the
   * advance-warning notification all used to promise removals that could not
   * happen, and `cleanup_enabled` is off by default — so a fresh install with a
   * cleanup rule told every shared user their films were about to disappear.
   *
   * Note this is not the whole refusal set: the implausible-match guard needs a
   * Plex round trip and can only be answered mid-run, which is exactly why these
   * two are split out. These are the ones that persist.
   */
  function standingRefusal(now: number = Date.now()): string | null {
    if (!(getConfig("cleanup_enabled") ?? false)) return KILL_SWITCH_REFUSAL;

    const indexAge = indexAgeMs(now);
    if (indexAge == null) {
      return "the library has never been synced successfully, so local watch and metadata state cannot be trusted.";
    }
    if (indexAge > MAX_INDEX_AGE_MS) {
      return `the local library index was last synced ${Math.floor(indexAge / DAY_MS)} day(s) ago — "nobody has watched this" is exactly the claim that goes wrong on stale data.`;
    }
    return null;
  }

  /**
   * Will this row actually be actioned, as the engine would decide it?
   *
   * The queue page, the portal, the badge and the notification each grew their
   * own version of this question and each got a different answer — the page
   * mirrored the engine, the portal ignored the approval gate, the badge ignored
   * both, and none of them consulted the kill switch. One predicate, so a surface
   * that says "goes on the next run" means it.
   *
   * `held`, protection and mode are already resolved onto the row by
   * `queuedCandidates`; this adds the reasons that live outside it.
   */
  function willBeActioned(
    candidate: Pick<
      QueuedCandidate,
      "actionedAt" | "mode" | "held" | "isProtected" | "requiresApproval" | "approved" | "ruleEnabled"
    >,
    opts: { refusal?: string | null } = {},
  ): boolean {
    const refusal = opts.refusal === undefined ? standingRefusal() : opts.refusal;
    if (refusal) return false;
    if (candidate.actionedAt != null) return false;
    if (!candidate.ruleEnabled) return false;
    if (candidate.held || candidate.isProtected) return false;
    if (candidate.requiresApproval && !candidate.approved) return false;
    return true;
  }

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
  function recordMatches(ruleId: string, matches: CleanupMatch[], now: number = Date.now()): void {
    // At most one increment per day, whatever started the run.
    //
    // The streak's whole value is that it takes *time* — "these six films go
    // tomorrow unless you keep them" is only true if tomorrow is when it happens.
    // But nothing restricts a cleanup rule to the nightly batch: it can carry an
    // `item-added` trigger (`sync-recently-added` fires every 15 minutes), an
    // `item-watched` trigger (polled every 30 seconds), a cron of its own *plus*
    // the batch, and "Run now" is unthrottled. A streak of three could therefore
    // be reached in 45 minutes, or by pressing a button three times, which is the
    // same defect `preview.ts` already refuses to allow for previews: "previewing
    // three times would be enough to delete something".
    //
    // The day boundary is read in the configured timezone, like the schedules
    // people set these rules on.
    const today = localDayKey(now, configuredTimezone());
    // De-duplicate by rating key first. A grouped rule yields one group per
    // director, per language, per decade — and an item belongs to as many of
    // those as it has tracks or credits. Bumping once per appearance would let a
    // film with three audio languages reach a streak of three on its first run,
    // which is precisely the protection this whole table exists to provide.
    const byKey = new Map<string, CleanupMatch>();
    for (const match of matches) byKey.set(match.ratingKey, match);
    const unique = [...byKey.values()];
    const seen = new Set(byKey.keys());

    db.transaction(() => {
      const existing = db
        .select({
          ratingKey: cleanupCandidates.ratingKey,
          actionedAt: cleanupCandidates.actionedAt,
          lastMatchedAt: cleanupCandidates.lastMatchedAt,
        })
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
      // Rows this rule has already counted today. A second run on the same day
      // still refreshes the row — it stops the row being pruned as "no longer
      // matching", which is the other half of the streak — but does not advance it.
      const countedToday = new Set(
        existing
          .filter((r) => r.actionedAt == null && localDayKey(r.lastMatchedAt, configuredTimezone()) === today)
          .map((r) => r.ratingKey),
      );

      for (const match of unique) {
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
              streak: countedToday.has(match.ratingKey)
                ? sql`${cleanupCandidates.streak}`
                : sql`${cleanupCandidates.streak} + 1`,
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
  function dueForAction(
    ruleId: string,
    consecutiveRuns: number,
    limit: number,
    now: number = Date.now(),
  ): CleanupCandidate[] {
    const protectedKeys = protectedRatingKeys();
    const rows = db
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
      // Protection is applied after the query, so the limit still yields a full
      // batch when some of the leading rows are protected. Over-fetching by the
      // number of protected keys is enough for that in the worst case.
      .limit(protectedKeys.size > 0 ? limit + protectedKeys.size : limit)
      .all();

    const eligible = protectedKeys.size > 0 ? rows.filter((r) => !protectedKeys.has(r.ratingKey)) : rows;
    return eligible.slice(0, limit);
  }

  /** Everything currently protected, newest first. */
  function listProtections(): Protection[] {
    return db.select().from(cleanupProtections).orderBy(desc(cleanupProtections.createdAt)).all();
  }

  /**
   * Protect something. Idempotent — protecting twice is not an error, it is
   * someone pressing the button again because they weren't sure it took.
   */
  function addProtection(
    kind: ProtectionKind,
    value: string,
    label: string,
    note = "",
    now: number = Date.now(),
  ): void {
    const normalised = kind === "collection" ? value.trim().toLowerCase() : value.trim();
    if (!normalised) return;
    db.insert(cleanupProtections)
      .values({ kind, value: normalised, label: label.trim() || value.trim(), note, createdAt: now })
      .onConflictDoUpdate({
        target: [cleanupProtections.kind, cleanupProtections.value],
        set: { label: label.trim() || value.trim(), note },
      })
      .run();
  }

  function removeProtection(id: number): void {
    db.delete(cleanupProtections).where(eq(cleanupProtections.id, id)).run();
  }

  /**
   * The rating keys protection currently covers.
   *
   * Resolved rather than stored: a collection protection has to mean "whatever
   * is in it now", or it would freeze the membership at the moment the button
   * was pressed and quietly stop covering anything added since.
   */
  function protectedRatingKeys(): Set<string> {
    const rows = db.select().from(cleanupProtections).all();
    if (rows.length === 0) return new Set();

    const keys = new Set<string>();
    const collectionTitles: string[] = [];
    for (const row of rows) {
      if (row.kind === "item") keys.add(row.value);
      else if (row.kind === "collection") collectionTitles.push(row.value);
    }

    if (collectionTitles.length > 0) {
      // Matched on lower-cased title: a rule's collections keep their rating keys
      // now that runs reconcile, but one rebuilt after heavy churn still gets a
      // fresh key — and a protection that held onto the key would come loose the
      // first night that happened.
      const matching = db
        .select({ key: collections.plexRatingKey })
        .from(collections)
        .where(inArray(sql`lower(${collections.title})`, collectionTitles))
        .all();
      if (matching.length > 0) {
        for (let i = 0; i < matching.length; i += CHUNK) {
          const slice = matching.slice(i, i + CHUNK).map((m) => m.key);
          const members = db
            .select({ itemRatingKey: collectionItems.itemRatingKey })
            .from(collectionItems)
            .where(inArray(collectionItems.collectionRatingKey, slice))
            .all();
          for (const m of members) keys.add(m.itemRatingKey);
        }
      }
    }

    return keys;
  }

  /**
   * Record that somebody would rather this one stayed.
   *
   * A vote, not a hold: a shared user pressing a button in the portal must not
   * be able to silently overrule the server owner's rule. It is shown on the
   * queue beside the item, and the decision stays where it was.
   *
   * Idempotent — pressing it twice is one vote, not a way to stuff the ballot.
   */
  function recordKeepVote(ratingKey: string, userId: number, username: string, now: number = Date.now()): void {
    db.insert(cleanupKeepVotes)
      .values({ ratingKey, userId, username, votedAt: now })
      .onConflictDoUpdate({
        target: [cleanupKeepVotes.ratingKey, cleanupKeepVotes.userId],
        set: { username, votedAt: now },
      })
      .run();
  }

  function removeKeepVote(ratingKey: string, userId: number): void {
    db.delete(cleanupKeepVotes)
      .where(and(eq(cleanupKeepVotes.ratingKey, ratingKey), eq(cleanupKeepVotes.userId, userId)))
      .run();
  }

  /**
   * Is this item on somebody's cleanup queue at all?
   *
   * For the portal's Keep button, which is the one place a rating key arrives from
   * outside. A vote is shown on the admin's queue with the voter's name against
   * it, so an unqueued key would put a named row there for an item no rule has
   * ever matched.
   */
  function isQueuedCandidate(ratingKey: string): boolean {
    const row = db
      .select({ ratingKey: cleanupCandidates.ratingKey })
      .from(cleanupCandidates)
      .where(and(eq(cleanupCandidates.ratingKey, ratingKey), isNull(cleanupCandidates.actionedAt)))
      .limit(1)
      .get();
    return !!row;
  }

  /** Who has asked for each item to stay, keyed by rating key. */
  function keepVotesByItem(): Map<string, string[]> {
    const rows = db.select().from(cleanupKeepVotes).all();
    const byItem = new Map<string, string[]>();
    for (const row of rows) {
      byItem.set(row.ratingKey, [...(byItem.get(row.ratingKey) ?? []), row.username]);
    }
    return byItem;
  }

  /** The rating keys one person has voted for. */
  function keepVotesForUser(userId: number): Set<string> {
    return new Set(
      db
        .select({ ratingKey: cleanupKeepVotes.ratingKey })
        .from(cleanupKeepVotes)
        .where(eq(cleanupKeepVotes.userId, userId))
        .all()
        .map((r) => r.ratingKey),
    );
  }

  /**
   * What is about to be removed, for the portal.
   *
   * Only the destructive modes, and only where the removal can actually happen —
   * see `willBeActioned`. A list that included "will be labelled", or things
   * already spared, or every queued item on an install where cleanup is switched
   * off (which is the default), is asking people to worry about nothing; and a
   * portal that cries wolf is one nobody reads the week it matters.
   *
   * Items short of the streak are still listed, with `runsRemaining` so the
   * portal can distinguish "goes on the next run" from "three runs away". That
   * distance is the point of the feature — it is the window in which somebody can
   * say they would rather it stayed.
   */
  function leavingSoon(
    limit = 50,
    now: number = Date.now(),
    sectionKeys: readonly string[] = [],
  ): Array<{
    ratingKey: string;
    sectionId: string;
    title: string;
    runsRemaining: number;
  }> {
    const refusal = standingRefusal(now);
    if (refusal) return [];
    // Restricted to the libraries the viewer can see, when the caller says which:
    // warning somebody about a film in a library they cannot open is noise they
    // can do nothing about.
    const inScope = sectionKeys.length > 0 ? new Set(sectionKeys) : null;
    return queuedCandidates({ now })
      .filter(
        (c) =>
          (c.mode === "delete" || c.mode === "unmonitor") &&
          willBeActioned(c, { refusal }) &&
          (!inScope || inScope.has(c.sectionId)),
      )
      .slice(0, limit)
      .map((c) => ({ ratingKey: c.ratingKey, sectionId: c.sectionId, title: c.title, runsRemaining: c.runsRemaining }));
  }

  /**
   * Say yes (or take it back) to one item, for a rule that holds destructive
   * actions until asked.
   *
   * Per item rather than per rule or per batch. The whole value of the gate is
   * that it makes somebody look at the titles, and an "approve all" is a way of
   * not looking at them that takes one click.
   */
  function setCandidateApproval(ruleId: string, ratingKey: string, approved: boolean, now: number = Date.now()): void {
    db.update(cleanupCandidates)
      .set({ approvedAt: approved ? now : null })
      .where(and(eq(cleanupCandidates.ruleId, ruleId), eq(cleanupCandidates.ratingKey, ratingKey)))
      .run();
  }

  /** Stamp a candidate as done. The row stays as the audit trail. */
  function markActioned(ruleId: string, ratingKey: string, action: CleanupAction, now: number = Date.now()): void {
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
  function holdCandidate(ruleId: string, ratingKey: string, untilMs: number | null): void {
    db.update(cleanupCandidates)
      .set({ heldUntil: untilMs })
      .where(and(eq(cleanupCandidates.ruleId, ruleId), eq(cleanupCandidates.ratingKey, ratingKey)))
      .run();
  }

  /** Everything this rule has queued or actioned, newest activity first. */
  function listCandidates(ruleId: string): CleanupCandidate[] {
    return db
      .select()
      .from(cleanupCandidates)
      .where(eq(cleanupCandidates.ruleId, ruleId))
      .orderBy(desc(cleanupCandidates.streak), desc(cleanupCandidates.lastMatchedAt))
      .all();
  }

  /**
   * The cross-rule queue the `/cleanup` page renders.
   *
   * Joined to `rules` here rather than in the router because the page needs the
   * rule's name and its `consecutiveRuns` to say anything useful about a row,
   * and asking per row would be a query per item.
   */
  function queuedCandidates(opts: { includeActioned?: boolean; limit?: number; now?: number } = {}): QueuedCandidate[] {
    const now = opts.now ?? Date.now();
    const rows = db
      .select({
        candidate: cleanupCandidates,
        ruleName: rules.name,
        ruleEnabled: rules.enabled,
        config: rules.config,
        // Left-joined: a queued item the media index has not seen (or a show,
        // which carries no size of its own) still belongs on the list. It
        // arrives with a null size and is counted as unknown, never as zero.
        fileSize: mediaItems.fileSize,
      })
      .from(cleanupCandidates)
      .innerJoin(rules, eq(rules.id, cleanupCandidates.ruleId))
      .leftJoin(mediaItems, eq(mediaItems.ratingKey, cleanupCandidates.ratingKey))
      .where(opts.includeActioned ? undefined : isNull(cleanupCandidates.actionedAt))
      .orderBy(desc(cleanupCandidates.streak), asc(cleanupCandidates.firstMatchedAt))
      .limit(opts.limit ?? 500)
      .all();

    const protectedKeys = protectedRatingKeys();
    const votes = keepVotesByItem();

    return rows.map(({ candidate, ruleName, ruleEnabled, config, fileSize }) => {
      const action = (
        config as { action?: { consecutiveRuns?: number; mode?: string; requireApproval?: boolean } } | null
      )?.action;
      const consecutiveRuns = action?.consecutiveRuns ?? 3;
      return {
        ...candidate,
        ruleName,
        consecutiveRuns,
        mode: action?.mode ?? "",
        runsRemaining: Math.max(0, consecutiveRuns - candidate.streak),
        held: candidate.heldUntil != null && candidate.heldUntil > now,
        fileSize: fileSize ?? null,
        isProtected: protectedKeys.has(candidate.ratingKey),
        keepVotes: votes.get(candidate.ratingKey) ?? [],
        requiresApproval: action?.requireApproval === true,
        approved: candidate.approvedAt != null,
        ruleEnabled: ruleEnabled === 1,
      };
    });
  }

  /**
   * Queued and actioned counts per rule, for the Rules table.
   *
   * A collection count means nothing for a cleanup rule — it builds one shelf
   * and that's it. "12 queued / 3 removed" is the status someone actually wants.
   */
  function countsByRule(): Map<string, { queued: number; actioned: number }> {
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

  /**
   * How many destructive actions have landed in the last `windowMs`.
   *
   * The ceiling on destructive actions used to be a counter held in memory for
   * the length of one job run, which bounded exactly one batch: an ad-hoc single
   * rule run minted itself a fresh full budget, so running five rules by hand
   * granted five budgets, and splitting cleanup into its own job would have
   * granted another. Counting what actually happened, from the ledger that
   * already records it, is a ceiling that holds however the work was started —
   * scheduled, ad-hoc, or after a container restart mid-run.
   *
   * `collection_only` and `label` are excluded: nothing was removed, so nothing
   * was spent. This mirrors `isDestructiveMode` in contracts, expressed here as
   * the stored `action` values so the ledger stays the single source of truth.
   */
  function actionedSince(sinceMs: number): number {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(cleanupCandidates)
      .where(
        and(
          isNotNull(cleanupCandidates.actionedAt),
          gte(cleanupCandidates.actionedAt, sinceMs),
          inArray(cleanupCandidates.action, ["unmonitor", "delete"]),
        ),
      )
      .get();
    return row?.n ?? 0;
  }

  /**
   * Queue size for the sidebar badge — items due now or on the next run.
   *
   * Gated on the same predicate as everything else that claims a removal is
   * imminent: a badge counting deletions that cannot happen (cleanup switched
   * off, waiting on an approval nobody has given, owned by a disabled rule) is a
   * number that teaches people to ignore the badge.
   */
  function dueSoonCount(now: number = Date.now()): number {
    const refusal = standingRefusal(now);
    if (refusal) return 0;
    return queuedCandidates({ limit: 1000, now }).filter((r) => r.runsRemaining <= 1 && willBeActioned(r, { refusal }))
      .length;
  }

  return {
    standingRefusal,
    willBeActioned,
    recordMatches,
    dueForAction,
    listProtections,
    addProtection,
    removeProtection,
    protectedRatingKeys,
    recordKeepVote,
    removeKeepVote,
    isQueuedCandidate,
    keepVotesByItem,
    keepVotesForUser,
    leavingSoon,
    setCandidateApproval,
    markActioned,
    holdCandidate,
    listCandidates,
    queuedCandidates,
    countsByRule,
    actionedSince,
    /** What the Settings cap readout shows: the same window the run budget enforces. */
    actionedInLastDay: () => actionedSince(deps.now() - DAY_MS),
    dueSoonCount,
  };
}

export type Cleanup = ReturnType<typeof createCleanup>;

export const CleanupToken = token<Cleanup>("cleanup");
