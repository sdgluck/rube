import { desc, gte, sql } from "drizzle-orm";
import { DAY_MS } from "@tinkerbell/core";
import { bandwidthTests, db } from "@tinkerbell/db";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export type BandwidthTest = InferSelectModel<typeof bandwidthTests>;

/** How long a result stays interesting. Longer than health checks: a link's speed is a slow-moving fact. */
const RETENTION_MS = 90 * DAY_MS;

export function recordBandwidthTest(row: InferInsertModel<typeof bandwidthTests>): void {
  db.insert(bandwidthTests).values(row).run();
}

/** The most recent successful test, or null if there has never been one. */
export function getLatestBandwidthTest(): BandwidthTest | null {
  return (
    db
      .select()
      .from(bandwidthTests)
      .where(sql`${bandwidthTests.status} = 'ok'`)
      .orderBy(desc(bandwidthTests.startedAt))
      .limit(1)
      .get() ?? null
  );
}

/** Every test since `since`, oldest first — the history chart. */
export function getBandwidthHistory(since: number, limit = 50): BandwidthTest[] {
  const rows = db
    .select()
    .from(bandwidthTests)
    .where(gte(bandwidthTests.startedAt, since))
    .orderBy(desc(bandwidthTests.startedAt))
    .limit(limit)
    .all();
  return rows.reverse();
}

/** Recent successful upload figures, newest first — the regression baseline. */
export function recentUpMbps(limit = 5): number[] {
  return db
    .select({ upMbps: bandwidthTests.upMbps })
    .from(bandwidthTests)
    .where(sql`${bandwidthTests.status} = 'ok' and ${bandwidthTests.upMbps} is not null`)
    .orderBy(desc(bandwidthTests.startedAt))
    .limit(limit)
    .all()
    .map((r) => r.upMbps ?? 0);
}

/** Keep the table from growing unbounded. Called from `purge-runs`. */
export function pruneBandwidthTests(): number {
  const cutoff = Date.now() - RETENTION_MS;
  return db
    .delete(bandwidthTests)
    .where(sql`${bandwidthTests.startedAt} < ${cutoff}`)
    .run().changes;
}
