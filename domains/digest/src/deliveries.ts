/**
 * The delivery ledger.
 *
 * Every send goes through `claimDelivery` first. The unique index on
 * (period, user, channel) is the whole mechanism: an insert that conflicts
 * means this exact digest has already been dealt with, and the caller returns
 * without sending. That is what makes a retried job — or a second run of the
 * same week — a no-op rather than a duplicate newsletter.
 *
 * The row is written *before* the send, not after. Written after, a crash
 * between "mail delivered" and "row inserted" re-sends on the retry, which is
 * the failure this exists to prevent; written before, the same crash leaves a
 * row that says `sent` for a message that may not have arrived. Losing one
 * digest is a strictly better failure than mailing it twice.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { digestDeliveries, type Db } from "@rube/db";

export type DeliveryStatus = "sent" | "failed" | "skipped_empty";

/** 0 is the server-wide digest — the one addressed to the admin's channels. */
export const SERVER_WIDE_USER_ID = 0;

export interface DeliveryKey {
  periodStart: number;
  periodEnd: number;
  userId: number;
  channel: string;
}

/** The ledger's identity: one row per period, per recipient, per channel. */
function matches(key: DeliveryKey) {
  return and(
    eq(digestDeliveries.periodStart, key.periodStart),
    eq(digestDeliveries.userId, key.userId),
    eq(digestDeliveries.channel, key.channel),
  );
}

export type DeliveryRow = typeof digestDeliveries.$inferSelect;

export interface DeliveriesDeps {
  db: Db;
}
export function createDeliveries(deps: DeliveriesDeps) {
  const { db } = deps;

  /**
   * Reserve this (period, user, channel) for sending.
   *
   * Returns false when it was already dealt with, which the caller must treat as
   * "nothing to do" rather than an error.
   *
   * One exception, and it is the difference between the feature working and
   * quietly not: a row recorded `skipped_empty` **is** re-claimable within the
   * same period. Nothing was sent for it, so re-claiming can't duplicate
   * anything — and without this, a job scheduled more often than its window
   * (daily runs, weekly digest) would record "nothing happened" on Monday and
   * then never send that week, however much arrived on Tuesday. A `failed` row
   * is deliberately *not* re-claimable: it represents an attempt that reached
   * the network, and retrying it every run for the rest of the period is how a
   * dead channel turns into a stream of duplicate half-sent mail.
   */
  function claimDelivery(key: DeliveryKey, now: number = Date.now()): boolean {
    const result = db
      .insert(digestDeliveries)
      .values({
        periodStart: key.periodStart,
        periodEnd: key.periodEnd,
        userId: key.userId,
        channel: key.channel,
        status: "sent",
        itemCount: 0,
        error: "",
        sentAt: now,
      })
      .onConflictDoNothing()
      .run();

    if (Number(result.changes ?? 0) > 0) return true;

    const retaken = db
      .update(digestDeliveries)
      .set({ status: "sent", sentAt: now, itemCount: 0, error: "" })
      .where(and(matches(key), eq(digestDeliveries.status, "skipped_empty")))
      .run();

    return Number(retaken.changes ?? 0) > 0;
  }

  /** Record how a claimed delivery actually turned out. */
  function completeDelivery(
    key: DeliveryKey,
    outcome: { status: DeliveryStatus; itemCount?: number; error?: string },
  ): void {
    db.update(digestDeliveries)
      .set({
        status: outcome.status,
        itemCount: outcome.itemCount ?? 0,
        // Truncated: a provider that returns an HTML error page shouldn't put a
        // kilobyte of markup in a column the UI renders in a table cell.
        error: (outcome.error ?? "").slice(0, 500),
      })
      .where(matches(key))
      .run();
  }

  /**
   * Release a claim so the next run tries again.
   *
   * Used when a send fails for a reason that is plausibly transient — a refused
   * SMTP connection, a 5xx from a webhook. A permanent failure keeps its
   * `failed` row instead, so it is visible and isn't retried forever.
   */
  function releaseDelivery(key: DeliveryKey): void {
    db.delete(digestDeliveries).where(matches(key)).run();
  }

  /** Recent deliveries, newest first — what Settings renders. */
  function recentDeliveries(limit = 50): DeliveryRow[] {
    return db.select().from(digestDeliveries).orderBy(desc(digestDeliveries.sentAt)).limit(limit).all();
  }

  /** Every delivery recorded for one period, whatever its outcome. */
  function deliveriesForPeriod(periodStart: number): DeliveryRow[] {
    return db.select().from(digestDeliveries).where(eq(digestDeliveries.periodStart, periodStart)).all();
  }

  /**
   * When this user last had a digest sent, so a monthly subscriber isn't sent
   * one by a weekly job run.
   *
   * Reads only `sent` rows: a skipped-empty week shouldn't push a monthly
   * subscriber's next digest out by a month.
   */
  function lastSentAt(userId: number, since: number): number | null {
    const row = db
      .select({ sentAt: digestDeliveries.sentAt })
      .from(digestDeliveries)
      .where(
        and(
          eq(digestDeliveries.userId, userId),
          eq(digestDeliveries.status, "sent"),
          gte(digestDeliveries.sentAt, since),
        ),
      )
      .orderBy(desc(digestDeliveries.sentAt))
      .limit(1)
      .get();
    return row?.sentAt ?? null;
  }

  return { claimDelivery, completeDelivery, releaseDelivery, recentDeliveries, deliveriesForPeriod, lastSentAt };
}
