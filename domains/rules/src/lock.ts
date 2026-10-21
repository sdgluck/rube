/**
 * Cross-context rule locking.
 *
 * See the `ruleLocks` table comment for why this is in SQLite rather than a
 * Map: the two things that race — the `generate` command (Sidequest worker
 * thread) and an ad-hoc single-rule run (API process) — do not share a heap.
 * They do share a database file.
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { ruleLocks, type Db } from "@rube/db";

/**
 * How long a lock stays valid without a renewal. Long enough that a slow
 * Plex call can't cost a live holder its lock, short enough that a crashed
 * holder's rule is runnable again within a minute.
 */
export const RULE_LOCK_LEASE_MS = 60_000;

/** Renewal cadence — a third of the lease, so two missed renewals are survivable. */
const RENEW_INTERVAL_MS = RULE_LOCK_LEASE_MS / 3;

/** How often `withRuleLock` retries while waiting for a lock to free up. */
const POLL_INTERVAL_MS = 250;

export interface RuleLockHandle {
  ruleId: string;
  holder: string;
}

export interface RuleLockInfo {
  holder: string;
  holderLabel: string;
  acquiredAt: number;
  expiresAt: number;
}

/** Thrown by `withRuleLock` when the lock could not be taken within the wait budget. */
export class RuleLockedError extends Error {
  readonly ruleId: string;
  readonly heldBy: string;

  constructor(ruleId: string, heldBy: string) {
    super(
      `Rule "${ruleId}" is already being run by ${heldBy || "another run"}. ` +
        `Running it twice at once would leave duplicate collections in Plex.`,
    );
    this.name = "RuleLockedError";
    this.ruleId = ruleId;
    this.heldBy = heldBy;
  }
}

/** A token unique to this attempt, so a stale holder can never renew or release someone else's lock. */
function newHolderToken(): string {
  return `${process.pid}:${randomUUID()}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface LockDeps {
  db: Db;
}
export function createLock(deps: LockDeps) {
  const { db } = deps;

  /**
   * Take the lock if it is free or its lease has lapsed. One statement, so two
   * callers racing on the same rule cannot both win: the conflicting upsert is
   * a no-op (0 changes) unless the existing lease has genuinely expired.
   */
  function acquireRuleLock(ruleId: string, holderLabel: string, now = Date.now()): RuleLockHandle | null {
    const holder = newHolderToken();
    const expiresAt = now + RULE_LOCK_LEASE_MS;
    const result = db.run(sql`
    INSERT INTO rule_locks (rule_id, holder, holder_label, acquired_at, expires_at)
    VALUES (${ruleId}, ${holder}, ${holderLabel}, ${now}, ${expiresAt})
    ON CONFLICT(rule_id) DO UPDATE SET
      holder = excluded.holder,
      holder_label = excluded.holder_label,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
    WHERE rule_locks.expires_at <= ${now}
  `);
    return Number(result.changes ?? 0) > 0 ? { ruleId, holder } : null;
  }

  /** Push the lease forward. Returns false if the lock was lost (expired and retaken). */
  function renewRuleLock(handle: RuleLockHandle, now = Date.now()): boolean {
    const result = db.run(sql`
    UPDATE rule_locks SET expires_at = ${now + RULE_LOCK_LEASE_MS}
    WHERE rule_id = ${handle.ruleId} AND holder = ${handle.holder}
  `);
    return Number(result.changes ?? 0) > 0;
  }

  /** Release, but only if we still hold it — never stomp a lock that was taken over. */
  function releaseRuleLock(handle: RuleLockHandle): void {
    db.run(sql`DELETE FROM rule_locks WHERE rule_id = ${handle.ruleId} AND holder = ${handle.holder}`);
  }

  /** Current holder of a rule's lock, or null when free or lapsed. */
  function getRuleLock(ruleId: string, now = Date.now()): RuleLockInfo | null {
    const row = db.select().from(ruleLocks).where(eq(ruleLocks.ruleId, ruleId)).get();
    if (!row || row.expiresAt <= now) return null;
    return { holder: row.holder, holderLabel: row.holderLabel, acquiredAt: row.acquiredAt, expiresAt: row.expiresAt };
  }

  /**
   * Run `fn` holding the rule's lock, renewing it for as long as `fn` runs and
   * releasing it however `fn` ends.
   *
   * `waitMs` exists for the caller that has just cancelled a previous run of the
   * same rule: abort is asynchronous, and the outgoing run may still be a beat
   * away from releasing. Batch callers pass 0 — a rule already being generated
   * elsewhere is a rule to skip, not to queue behind for minutes.
   *
   * Throws `RuleLockedError` if the lock never came free.
   */
  async function withRuleLock<T>(
    ruleId: string,
    holderLabel: string,
    fn: () => Promise<T>,
    options: { waitMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { waitMs = 0, signal } = options;
    const deadline = Date.now() + waitMs;

    let handle = acquireRuleLock(ruleId, holderLabel);
    while (!handle && Date.now() < deadline) {
      if (signal?.aborted) break;
      await sleep(POLL_INTERVAL_MS);
      handle = acquireRuleLock(ruleId, holderLabel);
    }
    if (!handle) throw new RuleLockedError(ruleId, getRuleLock(ruleId)?.holderLabel ?? "");

    // `unref` so a renewal timer can never hold the process open past the work
    // it exists to protect.
    const renewal = setInterval(() => renewRuleLock(handle), RENEW_INTERVAL_MS);
    renewal.unref?.();
    try {
      return await fn();
    } finally {
      clearInterval(renewal);
      releaseRuleLock(handle);
    }
  }

  return { acquireRuleLock, renewRuleLock, releaseRuleLock, getRuleLock, withRuleLock };
}
